import * as babel from '@babel/core';
import * as t from '@babel/types';
import * as parser from '@babel/parser';
import yargs from 'yargs';
import { readFileSync, promises as fsPromises } from 'fs';
import { getMatchingFlowForLOC } from './utils';
import { Flow, FlowLocation } from './types';
import { transformPair } from './transformations';
import generate from '@babel/generator';

/*

High level, pie-in-the-sky ideas: 

1. Parse the sequelize model file and pass it in here. E.g., can find if models are associated and suggest
   appropriate transformations depending. Can also automatically transform the model.

*/

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

/**
 * This CLI takes in:
 *
 * - pathTo: the path to the directory that you want to transform. This will be the root of the project.
 * - flows: a file containing taint flows. Pairs of the form (source, sink) ORM calls will be transformed.
 * 
 */
const argv = yargs(process.argv.slice(2)).options({
    pathTo: { type: 'string' },
    flows:  { type: 'string' }
}).parseSync();

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

    const srcVarName = pair.sourceVarName;

    transformPair(srcMethodName, sinkMethodName, srcVarName, src, sink);
});

// Once the nodes are updates, apply the transformations.
asts.forEach(ast => {
    fsPromises.writeFile('tmp.js', generate(ast).code);
});