import * as t from '@babel/types';
import { program } from 'babel-types';
import path = require('path/posix');

const supportedSinks = ['findAll', 'count', 'findOne', 'findByPk'];

// Check if path corresponds to a loop.
function isALoopPath(path) {
    return path.isForInStatement() || path.isForOfStatement() || path.isForStatement() || path.isWhileStatement() || path.isDoWhileStatement();
}

function isALoopFunction(path) {
    return path.isCallExpression() && path.node.callee.type == 'MemberExpression' && path.node.callee.property.name == 'forEach' ||
           path.isCallExpression() && path.node.callee.type == 'MemberExpression' && path.node.callee.property.name == 'map' ||
           path.isCallExpression() && path.node.callee.type == 'MemberExpression' && path.node.callee.property.name == 'filter';
}

export function confirmNPlusOne(sourcePath, sinkPath) {
    const sinkNodeAsCE : t.CallExpression = sinkPath.node as t.CallExpression;
    const sourceNodeAsCE : t.CallExpression = sourcePath.node as t.CallExpression;

    let loopAboveSink = false;
    let loopPath;
    let sinkParent = sinkPath;
    while (sinkParent = sinkParent.parentPath) {
        if (isALoopPath(sinkParent) || isALoopFunction(sinkParent)) {
            loopAboveSink = true;
            loopPath = sinkParent;
        }
    }

    // Now, check if the loop is between the source and sink LOCs.
    if (loopAboveSink) {
        if (sourcePath.node.loc.start.line < loopPath.node.loc.start.line)
            return loopPath;
    }

    return null;
}

export function parseArgumentObjOfAPICall(path) : t.ObjectExpression {
    if (path.node.arguments.length > 0) {
        const arg = path.node.arguments[0];
        if (arg.type === 'ObjectExpression') {
            return arg;
        }
    }
    return null;
}

export function getObjectPropertyByName(obj, name) {
    return obj.properties.find(prop => prop.key.name === name);
}

export function getRandomNameModifier() {
    return Math.random().toString(36).substring(2, 6);
}

export function insertBeforeLoopPath(loopPath, node) {
    const loopParentPath = loopPath.parentPath;

    // Check if loopParentPath is a call expression to Promise.all.
    if (loopParentPath.node.type == "CallExpression" && 
        loopParentPath.node.callee.type === 'MemberExpression' && 
        loopParentPath.node.callee.property.name === 'all' &&
        loopParentPath.node.callee.object.name === 'Promise') {
        // If so, insert the node before the call expression.
        loopParentPath.getStatementParent().insertBefore(node);
    } else {
        // Otherwise, insert the node before the loop.
        loopPath.insertBefore(node);
    }
}

export function createPropertyAccessForNewQuery(newName, exactSinkPath) {
    // Change the base of exactSinkPath to be newName.
    const exactSinkNode = exactSinkPath.node;
    // Either it's <>.dataValues.colName, or <>.colName.
    // Or! <>[i].colName or <>[i].dataValues.colName.
    // In any case, this should always be true.
    if (exactSinkNode.type === 'MemberExpression') {
        if (exactSinkNode.object.type === 'MemberExpression') {
            if (exactSinkNode.object.property.name === 'dataValues') {
                return t.memberExpression(t.memberExpression(t.identifier(newName), t.identifier('dataValues')), exactSinkNode.property);
            } else if (exactSinkNode.object.computed) { // Extra case for <>[i].colName
                return t.memberExpression(t.identifier(newName), exactSinkNode.property);
            } else {
                console.error('[createPropertyAccessForNewQuery] Error: dataValues not where expected.');
            }
        } else {
            return t.memberExpression(t.identifier(newName), exactSinkNode.property);
        }
    } else {
        console.error('[createPropertyAccessForNewQuery] Error: Exact sink path is not a MemberExpression.');
    }

    return null;
}

export function createNewPropertyValueForNewQuery(newName, exactSinkPath, sourceVarName) {
    // Get the new prop access.
    const newPropAccess = createPropertyAccessForNewQuery(newName, exactSinkPath);

    // Put it in a map.
    const newPropValue = t.callExpression(t.memberExpression(t.identifier(sourceVarName), t.identifier('map')), 
        [t.arrowFunctionExpression([t.identifier(newName)], newPropAccess)]);

    return newPropValue;
}

// Heuristics for trying to get the model name if the model is aliased.
// Currently: 1. Will check the imports to see if anything is imported.
export function tryToGetModelName(modelAliasName, sinkPath) {
    let modelName = undefined;
    
    // Heuristic 1. Go to the top of the file, and try to see if the model is imported under the `modelAliasName`.
    const program = sinkPath.findParent(p => p.isProgram());
    const imports = program.node.body.filter(p => p.type === 'ImportDeclaration');
    const requires = program.node.body.filter(p => p.type === 'VariableDeclaration');

    // TODO: This for imports.
    requires.forEach(variableDeclaration => {
        // Look at the sub variable declarators.
        variableDeclaration.declarations.forEach(declarator => {
            if (declarator.id.name === modelAliasName) {
                // This is the one.
                // Go through the init; if it's a require, look at the string.
                if (declarator.init.type === 'CallExpression') {
                    // Are we calling require?
                    if (declarator.init.callee.type === 'Identifier' && declarator.init.callee.name === 'require') {
                        // Yes, we are.
                        // Is the string a string literal?
                        if (declarator.init.arguments[0].type === 'StringLiteral') {
                            // Yes, it is.
                            // Get the string.
                            const modelPath = declarator.init.arguments[0].value;
                            // Get the model name.
                            modelName = path.basename(modelPath);
                        }
                    }
                }
            }
        }
    )});

    return modelName;
}

export function getModelNameIfInInclude(exactSinkPath) {
    // Are we in an include?
    let modelName = undefined;
    const includePath = exactSinkPath.findParent(p => p.isObjectProperty() && p.node.key.name === 'include');
    if (includePath) {
        // Ok. The model name will be in the value of the model property of the object referred to by this property.
        const modelNode = includePath.node.value.properties.find(p => p.key.name === 'model');

        // The model name is in there.
        // Note: there are gon be heuristics here. For example, if the model is aliased, we need to look at the imports.
        // Also, the model might be at the end of some chain of property accesses, e.g., `SequelizeImport.database.models.User`.
        if (modelNode.value.type === 'Identifier') {
            modelName = modelNode.value.name;
        } else if (modelNode.value.type === 'MemberExpression') {
            // Grab the property.
            modelName = modelNode.value.property.name;
        }
    } else {
        // This exact sink path is not in an include, so the name will the object on the API call expression.
        const apiCallPath = exactSinkPath.findParent(p => p.isCallExpression() && p.node.callee.type === 'MemberExpression' && supportedSinks.indexOf(p.node.callee.property.name) > -1);
        if (apiCallPath.node.callee.object.type === 'Identifier') {
            modelName = apiCallPath.node.callee.object.name;
        } else if (apiCallPath.node.callee.object.type === 'MemberExpression') {
            modelName = apiCallPath.node.callee.object.property.name;
        }
    }
    // TODO: Check for alias here. Or, check for alias in caller?
    return modelName;
}

// Idea: & together all of the boolean sub expressions.
export function makeBigBooleanCheck(booleanSubExpressions) {
    return booleanSubExpressions.reduce((accumulator, current) =>
        t.binaryExpression('&', accumulator, current)
    );
}