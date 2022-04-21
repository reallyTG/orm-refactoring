import * as t from '@babel/types';
import { program } from 'babel-types';
import path = require('path/posix');

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

// export function getColumnProperty(exactSinkPath) {
//     const exactSinkNode = exactSinkPath.node;

//     // This should always be the case.
//     if (exactSinkNode.type === 'MemberExpression') {
//         console.log('~~~~~~~~~~~~~~~~~~~~~~');
//         if (exactSinkNode.object.type === 'MemberExpression' &&
//             exactSinkNode.object.property === 'dataValues') {
//             // We want to keep this.
            
//         }
//     }
//     // const sourceColName = exactSinkPath.node.property.name;
// }