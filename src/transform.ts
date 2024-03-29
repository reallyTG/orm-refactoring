import * as babel from '@babel/core';
import * as t from '@babel/types';
import * as parser from '@babel/parser';
import yargs from 'yargs';
import { readFileSync, readdirSync, promises as fsPromises } from 'fs';
import { getMatchingFlowForLOC, parseCodeQLFlowFile, getMatchingFlowForLOCCodeQL, locMatchesExactSink } from './utils';
import { Flow, Relationship, Model } from './types';
import { transformPair } from './transformations';
import generate from '@babel/generator';

/***********************************************************i*******************/
//
// This is the entrypoint for automated transformations.
//
// Usage: node transform.js 
//          --mode=["CodeQL" | "Augur"] 
//          --pathTo=<path-to-the-project> 
//          --flows=<path-to-the-flows-file> 
//          --models=<path-to-the-model-directory> 
//          --sequelize-file=<path-to-the-sequelize-file>
//
/******************************************************************************/

// TODO: specify file format for flows file
// TODO: the analysis needs to add the top-level directory to the path
// They include:
// 1. the source and sink line information;
// 2. the file path for each;
// 3. ???
//
// The file should be able to contain many such flows.
//
// Example:
const sampleString = `{
    "source": {"type":"functionReturn","location":{"fileName":"src/controllers/user.js","pos":{"start":[55,22],"end":[66,5]}},"name":"findAll"},
    "sink": {"type":"functionInvocation","location":{"fileName":"src/controllers/user.js","pos":{"start":[73,25],"end":[73,69]}},"name":"count"}
}`;

const sampleString2 = `{
    "source": {
        "type": "functionReturn",
        "location": {
            "fileName": "src/controllers/user.js",
            "pos": {
                "start": [193, 26],
                "end": [201, 5]
            }
        },
        "name": "findAll"
    },
    "sink": {
        "type": "functionInvocation",
        "location": {
            "fileName": "src/controllers/user.js",
            "pos": {
                "start": [219, 36],
                "end": [221, 7]
            }
        },
        "name":"count"
    }
}`

// TODO: Some projects define the associations within the models themselves.

/**
 * This CLI takes in:
 *
 * - pathTo: the path to the directory that you want to transform. This will be the root of the project.
 * - flows: a file containing taint flows. Pairs of the form (source, sink) ORM calls will be transformed.
 * 
 */
const argv = yargs(process.argv.slice(2)).options({
    pathTo:         { type: 'string' },
    flows:          { type: 'string' },
    mode:           { type: 'string' },
    models:         { type: 'string' },
    sequelizeFile:  { type: 'string' }
}).parseSync();

// Parse model files.
// TODO
const modelDirectory = argv.models;
const modelFiles = readdirSync(modelDirectory);
const models = [];

// TODO: Add to this in the model parsing.
const validRelationships = ['hasMany', 'belongsTo', 'hasOne', 'belongsToMany'];
const relationships : Relationship[] = [];

modelFiles.forEach(modelFile => {
    const modelsInFile = parseSequelizeModelFile(`${modelDirectory}/${modelFile}`);
    models.push(...modelsInFile);
});

// Parse sequelize file.
const sequelizeFile = argv.sequelizeFile;
if (sequelizeFile !== undefined) {
    const sequelizeFileContents = readFileSync(sequelizeFile, 'utf8');

    // Have Babel look at the file contents.
    const seuqelizeFileAST = babel.parseSync(sequelizeFileContents);

    babel.traverse(seuqelizeFileAST, {
        // We're mainly looking at CallExpressions:
        // e.g., Video.hasMany(Comment), User.belongsTo(Video, { through: 'View' })
        CallExpression(path) {
            // Important things to look out for:
            // 1. the relationships at all (e.g., Video.hasMany(Comment))
            // 2. the presence of a through table (e.g., User.belongsTo(Video, { through: 'View' }))
            const asCallExpression = path.node;
            const callee = asCallExpression.callee;
            // Probably the callee is a MemberExpression.
            if (callee.type === 'MemberExpression') {
                // The object will be the model, the property will be the relationship.
                const model = callee.object;
                const relationship = callee.property;
                if (validRelationships.includes(relationship.name)) {
                    // Ok, now we parse the arguments.
                    const args = asCallExpression.arguments;
                    // The first argument is the model that we're relating to.
                    const relatedModel = args[0];
                    if (args.length > 1) {
                        // The second argument has more information.
                        const extraInfoObject = args[1];
                        // It's probably an object, right?
                        if (extraInfoObject.type == "ObjectExpression") {
                            // Go through all the fields:
                            let isThrough = null;
                            // Default foreign key name:
                            let foreignKeyName = `${model.name.toLowerCase()}Id`;
                            extraInfoObject.properties.forEach(property => {
                                switch (property.key.name) {
                                    case 'through':
                                        // Probably it'll be an identifier.
                                        isThrough = property.value.name;
                                        break;
                                    case 'foreignKey':
                                        // It'll be a string literal.
                                        foreignKeyName = property.value.value;
                                        break;
                                }
                            });
                            // Now we have all the information we need.
                            const relationship = new Relationship(model.name, relatedModel.name, foreignKeyName, isThrough);
                            relationships.push(relationship);
                        }
                    }
                }
            }
        }
    });
}

// There are two modes: CodeQL and Augur.
// Automated transformations are limited to:
// (1) flows that are contained in a single file;
// (2) ... TODO ...
//
if (argv.mode === 'CodeQL') {
    const codeQLFlows = parseCodeQLFlowFile(argv.flows);

    // Get files.
    const filesToTransform = new Set();
    codeQLFlows.forEach(flow => filesToTransform.add(flow.sourceFile));

    // Save the ASTs.
    const asts = {};

    // Initialize transformNodePairs with objects containing sources and sinks.
    const transformNodePairs : Array<{source : any, sourceName: string, sink : any, sinkName: string, exactSinks: any, dealtWith : boolean}> = codeQLFlows.map(() => {
        return { source: {}, sourceName: '', sink: {}, sinkName: '', exactSinks: [], dealtWith: false };
    });

    // Read each file, and determine nodes involved in the transformation.
    [...filesToTransform].forEach((file : string) => {
        console.log('Finding flows in:', file);
        const fileContents = readFileSync(file, 'utf8');

        const ast = babel.parseSync(fileContents);
        asts[file] = ast;

        babel.traverse(ast, {
            CallExpression(path) {
                const thisLOC = path.node.loc;

                let matchingFlows;
                if (matchingFlows = getMatchingFlowForLOCCodeQL(thisLOC, codeQLFlows, file)) {
                    matchingFlows.forEach((matchingFlow) => {
                        if (matchingFlow.isSource) {
                            transformNodePairs[matchingFlow.flow.UID].source = path;
                            transformNodePairs[matchingFlow.flow.UID].sourceName = matchingFlow.flow.sourceType;
                        } else { /* matchingFlow.isSource === false, so it's a sink */
                            transformNodePairs[matchingFlow.flow.UID].sink = path;
                            transformNodePairs[matchingFlow.flow.UID].sinkName = matchingFlow.flow.sinkType;
                            // transformNodePairs[matchingFlow.flow.UID].exactSink = matchingFlow.flow.exactSink;
                            // Get the actual babel thing matching the exact sink.
                            // console.log(matchingFlow);
                            let exactSinkBabelPath = null;
                            babel.traverse(path.node, {
                                Expression(subPath) {
                                    const exactSinkFlowObj = {
                                        start: [ matchingFlow.flow.exactSinkStartLine, matchingFlow.flow.exactSinkStartCol], 
                                        end: [ matchingFlow.flow.exactSinkEndLine, matchingFlow.flow.exactSinkEndCol]
                                    };
                                    // console.log(subPath.node.loc);
                                    // console.log(exactSinkFlowObj);
                                    if (locMatchesExactSink(subPath.node.loc, exactSinkFlowObj)) {
                                        exactSinkBabelPath = subPath;
                                    }
                                }
                            }, path.scope, path);
                            transformNodePairs[matchingFlow.flow.UID].exactSinks = [exactSinkBabelPath];
                        }
                    });
                }
            }
        });
    });

    const uniqueTransformNodePairs = [];
    // We need to handle the case where two API calls have multiple flows.
    // Maintain a list of unique transform pairs.
    // For any pair that hasn't been dealt with, that matches a unique transform pair, add its exact sink to 
    // the list that the unique transform pair has.
    // This way, each unique transform pair will have a list of sinks that are in its scope.
    transformNodePairs.forEach((transformNodePair) => {
        if (transformNodePair.dealtWith)
            return;

        const match = uniqueTransformNodePairs.find(otherPair => 
            transformNodePair.source.node === otherPair.source.node &&
            transformNodePair.sink.node === otherPair.sink.node
        )

        if (match === undefined) {
            // Didn't find it; add it.
            uniqueTransformNodePairs.push(transformNodePair);
            transformNodePair.dealtWith = true;
        } else {
            match.exactSinks.push(...transformNodePair.exactSinks);
        }
    });

    // Step 2: Transform the nodes.
    uniqueTransformNodePairs.forEach(pair => {

        const src /* : t.CallExpression */ = pair.source; 
        const sink /* : t.CallExpression */ = pair.sink;
    
        const srcAPICall = pair.sourceName;
        const sinkAPICall = pair.sinkName;
        const exactSinks = pair.exactSinks;
    
        transformPair(srcAPICall, sinkAPICall, src, sink, exactSinks, relationships, models);
    });

    // Once the nodes are updates, apply the transformations.
    for (const file in asts) {
        // TODO: We can probably do a better job of this, but let's add an import to
        // TODO: Sequelize, i.e., const Sequelize = require('sequelize');
        // TODO: Also, we want to make sure that there isn't already a Sequelize import.
        // TODO: Check if static imports or not.
        // const sequelizeImport = t.importDeclaration([], t.stringLiteral('sequelize'));
        const sequelizeRequire = t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier('Sequelize'), 
            t.callExpression(t.identifier('require'), [t.stringLiteral('sequelize')]))]);
            
        // Add to the ast.
        asts[file].program.body.unshift(sequelizeRequire);

        fsPromises.writeFile(file, generate(asts[file]).code); 
    }

} else if (argv.mode === 'Augur') {
    const exampleFlow = JSON.parse(sampleString);
    // TODO: add IDs to each flow
    exampleFlow.source.UID = 0;
    exampleFlow.sink.UID = 0;
    const flows : Array<{ source: Flow, sink: Flow }> = [ exampleFlow ];
    
    // Initialize transformNodePairs with objects containing sources and sinks.
    const transformNodePairs : Array<{source : any, sink : any, sourceVarName : string}> = flows.map(() => {
        return { source: {}, sink: {}, sourceVarName: '' };
    })
    
    const fileNamesToTransform = flows.map(flow => flow.source.location.fileName);
    
    // TODO does this work? WIP.
    const asts = [];
    
    // Step 1: Locate all pairs of nodes that require transformation.
    fileNamesToTransform.forEach(file => {
        const pathToThisFile = argv.pathTo /* + '/' */ + file; // TODO: check for presence of trailing '/'
        const fileContents = readFileSync(pathToThisFile, 'utf-8');
        
        // Get AST for traversal later.
        const ast = babel.parseSync(fileContents);
        asts.push(ast);
    
        // Traverse and collect all relevant nodes.
        babel.traverse(ast, {
            CallExpression(path) {
                const thisLOC = path.node.loc;
                let matchingFlow;
                if (matchingFlow = getMatchingFlowForLOC(thisLOC, flows)) {
                    if (matchingFlow.isSource) {
                        transformNodePairs[matchingFlow.flow.UID].source = path;
                        // TODO This is assuming that the source is always assigned to something. It remains to be seen if this is universal.
                        const sourceVarName = path.findParent(path => t.isVariableDeclarator(path.node)).node.id.name;
                        transformNodePairs[matchingFlow.flow.UID].sourceVarName = sourceVarName;
                    } else { /* matchingFlow.isSource === false, so it's a sink */
                        transformNodePairs[matchingFlow.flow.UID].sink = path;
                    }
                }
            } 
        });
    });
    
    // Step 2: Transform the nodes.
    transformNodePairs.forEach(pair => {
        // There are different types of transformations required.
        // First, let's figure out which ORM calls need to be transformed.
        const src /* : t.CallExpression */ = pair.source; 
        const sink /* : t.CallExpression */ = pair.sink;
    
        const srcMethodName = src.node.callee.property.name;
        const sinkMethodName = sink.node.callee.property.name;
    
        // const srcVarName = pair.sourceVarName;
    
        transformPair(srcMethodName, sinkMethodName, src, sink, null, relationships, [] /* TODO NULL */);
    });
    
    // Once the nodes are updates, apply the transformations.
    asts.forEach(ast => {
        fsPromises.writeFile('tmp.js', generate(ast).code);
    });
} else {
    console.log('Please specify a valid mode.');
    process.exit(1);
}

function parseSequelizeModelFile(pathToModel) {
    // TODO: This. Not current required, though.
    // We're mainly looking at CallExpressions:
    // e.g., sequelize.define('User', { ... })

    const fileContents = readFileSync(pathToModel, 'utf8');
    const ast = babel.parseSync(fileContents);
    const models : Model[] = [];

    babel.traverse(ast, {
        CallExpression(path) {

            // We only care about the <sequelize>.define('Model', { ... }) call.
            if (path.node.callee.type === 'MemberExpression') {
                if (path.node.arguments.length <= 1)
                    return;
        
                const modelName = path.node.arguments[0].value;
                const modelDefinition = path.node.arguments[1];
                const modelDefinitionProperties = modelDefinition.properties;

                if (modelDefinitionProperties === undefined)
                    return;

                // One important thing we can figure out is the primary key.
                // It will have primaryKey: true.
                // id: {
                //     type: DataTypes.UUID,
                //     allowNull: false,
                //     primaryKey: true,
                //     defaultValue: Sequelize.UUIDV4,
                // },
                const properties = [];
                let primaryKey = 'id';
                modelDefinitionProperties.forEach(property => {
                    // The name will be something like 'id', but it's the value that we need to check.
                    // The value will be an object expression.
                    if (property.value.properties === undefined) 
                        return;

                    property.value.properties.forEach(subProperty => {
                        if (subProperty.key.name === 'primaryKey') {
                            if (subProperty.value.value === true) {
                                primaryKey = property.key.name;
                            }
                        }
                    });

                    // Add property name to property list regardless of whether or not it's a primary key.
                    properties.push(property.key.name);
                });

                models.push(new Model(modelName, properties, primaryKey, []));
            }
        }
    });

    return models;
}