import * as babel from '@babel/core';
import generate from '@babel/generator'; // For debugging.
import * as t from '@babel/types';
import { SourceMap } from 'module';
import { confirmNPlusOne, getObjectPropertyByName, parseArgumentObjOfAPICall } from './transform-utils';
import { Relationship, Model } from './types';

// BIG TODOS
// DONE 1 Parse the model. We might be able to generate better information if we have the model.
// -----> E.g., we need to figure out if we need to add an association.
// TODO: any is a cop out, figure out a better type.
// TODO: Find the name of the Sequelize import or require.
// TODO: Figure out if there are any variables with matching names in scope.
// TODO: Make a dictionary? Or, ensure that the find finds something.
// TODO: Write the code to file automatically.
export function transformPair(srcType : string, sinkType : string, src : any, sink : any, exactSink : string, relationships : Relationship[], models : Model[]) : void {

    console.log('Transforming pair: ' + srcType + ' -> ' + sinkType);
    if (srcType === 'findAll' && sinkType === 'count') {
        // Check if this is an N+1 situation.
        const loopPath = confirmNPlusOne(src, sink);
        if (loopPath != null) {
            const loopElement = getLoopElement(loopPath, src);
            transformFindAllIntoCountNPlusOne(src, sink, exactSink, loopPath, loopElement, relationships, models);
        } else {
            // We don't do anything if it isn't.
            // Same goes for the rest.
        }
    } else if (srcType === 'findAll' && sinkType === 'findOne') {
        const loopPath = confirmNPlusOne(src, sink);
        if (loopPath != null) {
            const loopElement = getLoopElement(loopPath, src);
            transformFindAllIntoFindOneNPlusOne(src, sink, exactSink, loopPath, loopElement, relationships, models);
        }
    } else if (srcType === 'findAll' && sinkType === 'findAll') {
        const loopPath = confirmNPlusOne(src, sink);
        if (loopPath != null) {
            const loopElement = getLoopElement(loopPath, src);
            transformFindAllIntoFindAllNPlusOne(src, sink, exactSink, loopPath, loopElement, relationships, models);
        }
    } else if (srcType === 'findAll' && sinkType === 'findByPk') {
        const loopPath = confirmNPlusOne(src, sink);
        if (loopPath != null) {
            const loopElement = getLoopElement(loopPath, src);
            transformFindAllIntoFindByPkNPlusOne(src, sink, exactSink, loopPath, loopElement, relationships, models);
        }
    } else {
        // Catch-all case.
        console.log('Unrecognized transformation: ' + srcType + ' -> ' + sinkType);
    }
}

// Get the name of the loop variable.
// E.g., if we have users.forEach((user) => { ... }), we want to get 'user'.
// E.g., if we have users = User.findAll(...); for(let i = 0; i < users.length; i++) {...}, we want to get users[i]
// We take in src for this last case, to construct src[i].
function getLoopElement(loopPath, src) {
    let loopElement;
    const srcVarDecl = src.findParent(path => t.isVariableDeclarator(path.node)).node;
    // TODO, there are a billion of these.
    switch (loopPath.node.type) {
        case 'ForStatement':
            // So we're going to have for loops like:
            // for (let i = 0; i < users.length; i++) 
            // and we want to figure out the 'loopVar'. 
            // It will be whatever the name of the source is (users), and the loop index (i).
            const loopIndexName = loopPath.node.init.declarations[0].id;
            const srcVarIdentifier = srcVarDecl.id;
            loopElement = t.memberExpression(srcVarIdentifier, loopIndexName, true);
            break;
        case 'CallExpression':
            // Here, we have users.forEach((user) => { ... }).
            // The loop element is the argument of the call expression.
            const callback = loopPath.node.arguments[0];
            loopElement = callback.params[0];
            break;
        default :
            // Cry I guess?
            console.log('Unrecognized loop type: ' + loopPath.node.type);
    }
    return loopElement;
}

function findExactSinkPathAndSinkColName(sinkPath, loopElement, exactSink) {
    let sinkColName, exactSinkPath, sourceColName;
    babel.traverse(sinkPath.node, {
        MemberExpression(path) {
            if (exactSink === generate(path.node).code) {
                exactSinkPath = path;
                // Here, we should get the parent propertyDefintion.
                // The parent of this will be our sinkColName.
                const parent = path.parentPath.node;
                if (parent.type === 'ObjectProperty') {
                    sinkColName = parent.key.name;
                }
            }

            if (generate(path.node.object).code === generate(loopElement).code) {
                sourceColName = path.node.property.name;
            }
        },
        Identifier(path) {
            if (path.node.name === exactSink) {
                // We found the sub-expression that we're looking for.
                exactSinkPath = path;

                const parent = path.parentPath.node;
                if (parent.type === 'ObjectProperty') {
                    sinkColName = parent.key.name;
                }
            }
        }
    }, sinkPath.scope, sinkPath);

    return [sinkColName, sourceColName, exactSinkPath];
}

// function findExactSinkPathAndSinkColName(sinkPath, loopVarName, exactSink) {
//     let sinkColName, exactSinkPath;
//     babel.traverse(sinkPath.node, {
//         MemberExpression(path) {
//             if (path.node.object.name === loopVarName) {

//                 // The parent of this will be our sinkColName.
//                 if (path.parentPath.node.type === 'MemberExpression') {
//                     sinkColName = path.parentPath.node.property.name;
//                 } else {
//                     // This is a bad thing. There are going to be more cases.
//                     sinkColName = path.parentPath.node.key.name
//                 }
//             }

//             if (exactSink === generate(path.node).code) {
//                 exactSinkPath = path;
//                 // Here, we should get the parent propertyDefintion.
//                 // ??? TODO
//             }
//         },
//         Identifier(path) {
//             if (path.node.name === exactSink) {
//                 // We found the sub-expression that we're looking for.
//                 exactSinkPath = path;
//             }
//         }
//     }, sinkPath.scope, sinkPath);

//     return [sinkColName, exactSinkPath];
// }

// function getLoopVarName(loopElement) {
//     let loopVarName;
//     if (loopElement.type === 'Identifier')
//         loopVarName = loopElement.name;
//     else if (loopElement.type === 'MemberExpression') {
//         loopVarName = loopElement.object.name;
//     } else {
//         console.log('ERROR: Unrecognized loop element type: ' + loopElement.type);
//     }
//     return loopVarName;
// }

function transformFindAllIntoFindAllNPlusOne(srcPath : any, sinkPath : any, exactSink : string, loopPath : any, loopElement : any, relationships : Relationship[], models : Model[]) {

    /* This is the idea:

    const lotsOfTickets = await Ticket.findAll({
        where: {
            evendId: eventList.map(event => event.id)
        }
    });
    const tickets = lotsOfTickets.filter(ticket => ticket.eventId === eventList[i].id);
    */

    const sinkModelName = sinkPath.node.callee.object.name;

    // Figure out what kind of statement the source is.
    // If it's an assignment, we need the name. (We should also check this name against what is being looped over, TODO.)
    const srcVarDecl = srcPath.findParent(path => t.isVariableDeclarator(path.node));
    if (srcVarDecl === undefined) {
        console.log('Uhhh, the source isn\'t a variable declaration. Expand this.');
        return;
    }
    const srcVarName = srcVarDecl.node.id.name;

    // First, let's get the name of the loop variable.

    // Now, let's traverse the sinkPath and figure out which parts refer to the loopElement.
    // We need to change those to refer to the source variable.
    const loopVarAccesses = [];
    let [sinkColName, sourceColName, exactSinkPath] = findExactSinkPathAndSinkColName(sinkPath, loopElement, exactSink);
    babel.traverse(sinkPath.node, {
        MemberExpression(path) {
            if (generate(path.node.object).code === generate(loopElement).code) {
                loopVarAccesses.push(path);
                // TODO: We should actually do this right, but right now, going to look
                // TODO: at the property name.
                const parentProperty = path.findParent(path => t.isObjectProperty(path.node));
                // ???
                sinkColName = parentProperty.node.key.name;
            }
        }
    }, sinkPath.scope, sinkPath);

    if (exactSinkPath === undefined) {
        console.log('We didn\'t find the exact sink. This is a problem.');
        return;
    }

    loopVarAccesses.forEach(path => {
        // Schema: loopVar.property -> srcVar.map(u => u.property)
        const newPropertyLookup = t.callExpression(
            t.memberExpression(t.identifier(srcVarName), t.identifier('map')),
            [t.arrowFunctionExpression(
                [t.identifier('u')],
                t.memberExpression(
                    t.identifier('u'),
                    t.identifier(path.node.property.name)
            ))]
        )
        path.replaceWith(newPropertyLookup);
    });
    
    // Make a new variable declaration for the updated sink.
    const newFindVariableName = `${sinkModelName.toLowerCase()}s`;
    
    const newSinkVarDecl = t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(newFindVariableName), t.awaitExpression(sinkPath.node))
    ]);

    // Make the new access to go in the loop.
    const newAccess = t.callExpression(
        t.memberExpression(t.identifier(newFindVariableName), t.identifier('filter')),
        [t.arrowFunctionExpression([t.identifier('data')], 
            t.binaryExpression(
                '===',
                t.memberExpression(t.identifier('data'), t.identifier(sinkColName)),
                t.memberExpression(loopElement, t.identifier(sourceColName))
            ))]
    )

    // console.log('/////////////////////////////////////////////////');
    // console.log('New sink thing:');
    // console.log(generate(newSinkVarDecl).code);

    // console.log('New access:');
    // console.log(generate(newAccess).code);
    // console.log('/////////////////////////////////////////////////');

    // Add the new findAll before the loop.
    loopPath.insertBefore(newSinkVarDecl);
    // Change the old findAll in the loop to the find.
    // TODO: There are a few cases here, I think. If the parent is an await expression, we need to delete it.
    // Check if sinkPath's parent is an await expression.
    const sinkParent = sinkPath.parentPath;
    if (sinkParent.node.type === 'AwaitExpression') {
        sinkParent.replaceWith(newAccess);
    } else {
        sinkPath.replaceWith(newAccess);
        console.log("[transformFindAllIntoFindAllNPlusOne] Please double-check that this is correct.");
    }
}

function transformFindAllIntoFindByPkNPlusOne(srcPath : any, sinkPath : any, exactSink : string, loopPath : any, loopElement : any, relationships : Relationship[], models : Model[]) {
    // Need this to generate a name for the new assignment.
    const sinkModelName = sinkPath.node.callee.object.name;

    // Figure out what kind of statement the source is.
    // If it's an assignment, we need the name. (We should also check this name against what is being looped over, TODO.)
    const srcVarDecl = srcPath.findParent(path => t.isVariableDeclarator(path.node));
    if (srcVarDecl === undefined) {
        console.log('Uhhh, the source isn\'t a variable declaration. Expand this.');
        return;
    }
    const srcVarName = srcVarDecl.node.id.name; 

    // Now, let's traverse the sinkPath and figure out which parts refer to the loopVarName.
    // We need to change those to refer to the source variable.
    let [sinkColName, sourceColName, exactSinkPath] = findExactSinkPathAndSinkColName(sinkPath, loopElement, exactSink);

    // Note: In this transformation, there won't be a sinkColName.
    // It's gonna be the primary key of the sink model. So, get it:
    let sinkModel = models.find(model => model.name === sinkModelName);
    sinkColName = sinkModel.primaryKey;

    if (exactSinkPath === undefined) {
        console.log('We didn\'t find the exact sink. This is a problem.');
        return;
    }
    
    // Make a new variable declaration for the updated sink.
    const newFindVariableName = `${sinkModelName.toLowerCase()}s`;

    const replacementAPICall = t.callExpression(t.memberExpression(t.identifier(sinkModelName), t.identifier('findAll')), [
        t.objectExpression([
            t.objectProperty(t.identifier('where'), t.objectExpression([
                t.objectProperty(t.identifier(sinkColName),
                t.callExpression(t.memberExpression(t.identifier(srcVarName), t.identifier('map')), [
                    t.arrowFunctionExpression([t.identifier('data')], t.memberExpression(t.identifier('data'), t.identifier(sourceColName)))
        ]))]))])
    ]);

    const newSinkVarDecl = t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(newFindVariableName), t.awaitExpression(replacementAPICall))
    ]);

    // Make the new access to go in the loop.
    const newAccess = t.callExpression(
        t.memberExpression(t.identifier(newFindVariableName), t.identifier('find')),
        [t.arrowFunctionExpression([t.identifier('data')], 
            t.binaryExpression(
                '===',
                t.memberExpression(t.identifier('data'), t.identifier(sinkColName)),
                t.memberExpression(loopElement, t.identifier(sourceColName))
            ))]
    )

    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');
    // console.log('New findAll:');
    // console.log(generate(newSinkVarDecl).code);

    // console.log('New access:');
    // console.log(generate(newAccess).code);
    // console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~');

    // Add the new findAll before the loop.
    loopPath.insertBefore(newSinkVarDecl);
    // Change the old findAll in the loop to the find.
    // TODO: There are a few cases here, I think. If the parent is an await expression, we need to delete it.
    // Check if sinkPath's parent is an await expression.
    const sinkParent = sinkPath.parentPath;
    if (sinkParent.node.type === 'AwaitExpression') {
        sinkParent.replaceWith(newAccess);
    } else {
        sinkPath.replaceWith(newAccess);
        console.log("[transformFindAllIntoFindByPkNPlusOne] Please double-check that this is correct.");
    }
}

/**
 * Transform a flow from findAll into findOne, where the sink is inside of a loop.
 */
function transformFindAllIntoFindOneNPlusOne(srcPath : any, sinkPath : any, exactSink : string, loopPath : any, loopElement : any, relationships : Relationship[], models : Model[]) : void {

    const sinkModelName = sinkPath.node.callee.object.name;

    // Figure out what kind of statement the source is.
    // If it's an assignment, we need the name. (We should also check this name against what is being looped over, TODO.)
    const srcVarDecl = srcPath.findParent(path => t.isVariableDeclarator(path.node));
    if (srcVarDecl === undefined) {
        console.log('Uhhh, the source isn\'t a variable declaration. Expand this.');
        return;
    }
    const srcVarName = srcVarDecl.node.id.name;

    let [sinkColName, sourceColName, exactSinkPath] = findExactSinkPathAndSinkColName(sinkPath, loopElement, exactSink);

    // We shall visit the sinkPath AST and find:
    // (1) the API call, which we will replace with findAll,
    // (2) the loop variable accesses, which will be modified when we transform the API call.
    const loopVarAccesses = [];
    let sinkAPICall; // This is the API call that we're going to transform.
    babel.traverse(sinkPath.node, {
        MemberExpression(path) {
            if (generate(path.node.object).code === generate(loopElement).code) {
                loopVarAccesses.push(path);
            }
        },
        Identifier(path) {
            if (path.node.name === 'findOne') {
                sinkAPICall = path;
            }
        }
    }, sinkPath.scope, sinkPath);

    if (exactSinkPath === undefined) {
        console.log('We didn\'t find the exact sink. This is a problem.');
        return;
    }

    loopVarAccesses.forEach(path => {
        // Schema: loopVar.property -> srcVar.map(u => u.property)
        const newPropertyLookup = t.callExpression(
            t.memberExpression(t.identifier(srcVarName), t.identifier('map')),
            [t.arrowFunctionExpression(
                [t.identifier('u')],
                t.memberExpression(
                    t.identifier('u'),
                    t.identifier(path.node.property.name)
            ))]
        )
        path.replaceWith(newPropertyLookup);
    });

    // Change the sink API call to findAll.
    sinkAPICall.replaceWith(t.identifier('findAll'));
    
    // Make a new variable declaration for the updated sink.
    const newFindVariableName = `${sinkModelName.toLowerCase()}s`;
    
    const newSinkVarDecl = t.variableDeclaration('const', [
        t.variableDeclarator(t.identifier(newFindVariableName), t.awaitExpression(sinkPath.node))
    ]);

    // Make the new access to go in the loop.
    const newAccess = t.callExpression(
        t.memberExpression(t.identifier(newFindVariableName), t.identifier('find')),
        [t.arrowFunctionExpression([t.identifier('data')], 
            t.binaryExpression(
                '===',
                t.memberExpression(t.identifier('data'), t.identifier(sinkColName)),
                t.memberExpression(loopElement, t.identifier(sourceColName))
            ))]
    )

    // console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    // console.log('New sink thing:');
    // console.log(generate(newSinkVarDecl).code);

    // console.log('New access:');
    // console.log(generate(newAccess).code);
    // console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

    // Add the new findAll before the loop.
    loopPath.insertBefore(newSinkVarDecl);
    // Change the old findAll in the loop to the find.
    // TODO: There are a few cases here, I think. If the parent is an await expression, we need to delete it.
    // Check if sinkPath's parent is an await expression.
    const sinkParent = sinkPath.parentPath;
    if (sinkParent.node.type === 'AwaitExpression') {
        sinkParent.replaceWith(newAccess);
    } else {
        sinkPath.replaceWith(newAccess);
        console.log("[transformFindAllIntoFindOneNPlusOne] Please double-check that this is correct.");
    }
}

function transformFindAllIntoCountNPlusOne(srcPath : any, sinkPath : any, exactSink : string, loopPath : any, loopElement : any, relationships : Relationship[], models : Model[]) : void {
    const sinkArgObj = parseArgumentObjOfAPICall(sinkPath);

    // TODO: Figure this out programmatically.
    const sequelizeImportName = 'Sequelize';

    // Figure out what kind of statement the source is.
    // If it's an assignment, we need the name. (We should also check this name against what is being looped over, TODO.)
    const srcVarDecl = srcPath.findParent(path => t.isVariableDeclarator(path.node));
    if (srcVarDecl === undefined) {
        console.log('Uhhh, the source isn\'t a variable declaration. Expand this.');
        return;
    }
    const srcVarName = srcVarDecl.node.id.name;

    // Find the sub-expression that matches exactSink.
    // This traversal may well serve multiple purposes.
    let [sinkColName, sourceColName, exactSinkPath] = findExactSinkPathAndSinkColName(sinkPath, loopElement, exactSink);

    if (exactSinkPath === null) {
        throw new Error(`Could not find exact sink ${exactSink}; bailing.`);
    }

    // If the exact sink is a MemberExpression, the property is the name of the column we need to join on.
    if (exactSinkPath.node.type === 'MemberExpression') {
        const sourceModelName = srcPath.node.callee.object.name;
        const sinkModelName = sinkPath.node.callee.object.name;
        
        const sourceColName = exactSinkPath.node.property.name;

        // 1. Construct the new Sequelize API call
        // 1.1 Construct the parts of the new API call.
        const newWhereClause = t.objectExpression([
            t.objectProperty(
                t.identifier(sinkColName), 
                t.callExpression(
                    t.memberExpression(t.identifier(srcVarName), t.identifier('map')), 
                    [t.arrowFunctionExpression([t.identifier('r')], t.memberExpression(t.identifier('r'), t.identifier(sourceColName)))]))
        ]);

        const newGroupClause = t.stringLiteral(`${sinkModelName}.${sinkColName}`);

        const newAttributeClause = t.arrayExpression([
            t.stringLiteral(sinkColName),
            t.arrayExpression([
                t.callExpression(
                    t.memberExpression(t.identifier(sequelizeImportName), t.identifier('fn')),
                    [t.stringLiteral('COUNT'), t.callExpression(
                        t.memberExpression(t.identifier(sequelizeImportName), t.identifier('col')),
                        // NOTE: There's a little plural here. That's because Sequelize will, by default, pluralize the model name.
                        [t.stringLiteral(`${sinkModelName}.${sinkColName}`)])]),
                t.stringLiteral(`${sinkModelName.toLowerCase()}Count`)
            ])
        ]);

        // 1.2. Construct the actual call by putting all these things together. 
        //      (Also, make it an await)
        const newAPICall = t.awaitExpression(t.callExpression(
            t.memberExpression(t.identifier(sinkModelName), t.identifier('findAll')),
            [t.objectExpression([
                t.objectProperty(t.identifier('where'), newWhereClause),
                t.objectProperty(t.identifier('group'), newGroupClause),
                t.objectProperty(t.identifier('attributes'), newAttributeClause)])
            ]
        ));

        // 1.3. Put it in an assigment.
        const newCountVariableName = `${sinkModelName.toLowerCase()}Counts`;
        const newAssignment = t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier(newCountVariableName), newAPICall)
        ]);

        // TODO: This might want to check for the undefined-ness of find(...).dataValues.
        const newAccessCallToFind = t.callExpression(
            t.memberExpression(t.identifier(newCountVariableName), t.identifier('find')),
            [t.arrowFunctionExpression(
                [t.identifier('r')], 
                t.binaryExpression(
                    '===', 
                    t.memberExpression(t.identifier('r'), t.identifier(sinkColName)), 
                    t.memberExpression(loopElement, t.identifier(sourceColName))))]);
        
        // const newAccessRHS = t.memberExpression(
        //     t.memberExpression(newAccessCallToFind, t.identifier('dataValues')),
        //     t.identifier(`${sinkModelName.toLowerCase()}Count`));

        // WIP: 
        const totallyNewVarDecl = t.variableDeclaration('const', [t.variableDeclarator(t.identifier(`${newCountVariableName}_tmp`), newAccessCallToFind)]);
        const newAccessRHS = t.conditionalExpression(
            t.binaryExpression('===', 
                t.identifier(`${newCountVariableName}_tmp`), 
                t.identifier('undefined')
            ), t.numericLiteral(0), 
            t.memberExpression(
                t.memberExpression( t.identifier(`${newCountVariableName}_tmp`), 
                    t.identifier('dataValues')), 
                t.identifier(`${sinkModelName.toLowerCase()}Count`)));

        // 3. Place and replace the components.
        // 3.1. Place the new API call assignment.
        // console.log('==========================================================');
        // console.log('Source location:', srcPath.node.loc.start, srcPath.node.loc.end);
        // console.log('New assignment:');
        // console.log(generate(newAssignment).code);

        // // 3.2. Replace the RHS of the old access.
        // // 3.2.1. Replace the entire sink with newAccessRHS.
        // console.log('Sink location:', sinkPath.node.loc.start, sinkPath.node.loc.end);
        // console.log('New sink:');
        // sinkPath.replaceWith(newAccessRHS);
        // console.log(generate(sinkPath.node).code);
        // console.log('==========================================================');
        

        // Add the new findAll before the loop.
        loopPath.insertBefore(newAssignment);
        // In this case, we need to check if the counts are undefined.
        // That check makes reference to a temporary variable, which is introduced here.
        sinkPath.getStatementParent().insertBefore(totallyNewVarDecl);
        
        // Change the old findAll in the loop to the find.
        // TODO: There are a few cases here, I think. If the parent is an await expression, we need to delete it.
        // Check if sinkPath's parent is an await expression.
        const sinkParent = sinkPath.parentPath;
        if (sinkParent.node.type === 'AwaitExpression') {
            sinkParent.replaceWith(newAccessRHS);
        } else {
            sinkPath.replaceWith(newAccessRHS);
            console.log("[transformFindAllIntoCountNPlusOne] Please double-check that this is correct.");
        }
    }    
}

/**
 * Transforms a flow from a findAll into count.
 * @param src the findAll node.
 * @param sink the count node.
 * @param srcVarName the name of the variable that the source is assigned to. This is, of course, assuming that it is assigned to a variable...
 */
function transformFindAllIntoCountNPlusOne_old(srcPath : any, sinkPath : any, exactSink : string, loopPath : any, loopElement : any, relationships : Relationship[]) : void {
    /*
        In general, we need to figure out:
            (1) Should we join, and if so, what should we join on? The flow was detected b/c something from the source
                was flowing into the sink; what is it, can we join on it, and do we need to update
                the model to allow this join?
            (2) We might not want to do a join. We can instead just issue one query (1 + 1) with a subquery to count.
                This is what we are going to do, since joining might not be possible.
    */ 
    
    /*
        Notes:
            (1) srcPath.node and sinkPath.node are CallExpressions;
    */

    const srcArgObj = parseArgumentObjOfAPICall(srcPath);
    const sinkArgObj = parseArgumentObjOfAPICall(sinkPath);

    // TODO: Figure this out programmatically.
    const sequelizeImportName = 'Sequelize';

    // Figure out what kind of statement the source is.
    // If it's an assignment, we need the name. (We should also check this name against what is being looped over, TODO.)
    const srcVarDecl = srcPath.findParent(path => t.isVariableDeclarator(path.node));
    if (srcVarDecl === undefined) {
        console.log('Uhhh, the source isn\'t a variable declaration. Expand this.');
        return;
    }
    const srcVarName = srcVarDecl.node.id.name;

    // Find the sub-expression that matches exactSink.
    // This traversal may well serve multiple purposes.
    let exactSinkPath = null;
    let sinkColName = null;
    babel.traverse(sinkArgObj, {
        // It will (likely, TODO) be a MemberExpression or a VariableExpression.
        MemberExpression(path) {
            // If the exactSink string has a period, then it's a MemberExpression.
            if (exactSink.includes('.')) {
                const [left, right] = exactSink.split('.');
                if (path.node.property.name === right && path.node.object.name === left) {
                    // We found the sub-expression that we're looking for.
                    exactSinkPath = path;

                    // Also, let's save the name of the property that the exactSink is a part of.
                    // This is important for later.
                    sinkColName = path.parent.key.name;
                }
            }
        },
        Identifier(path) {
            if (path.node.name === exactSink) {
                // We found the sub-expression that we're looking for.
                exactSinkPath = path;

                // Also, let's save the name of the property that the exactSink is a part of.
                // This is important for later.
                sinkColName = path.parent.key.name;
            }
        }
    }, sinkPath.scope, sinkPath);

    if (exactSinkPath === null) {
        throw new Error(`Could not find exact sink ${exactSink}; bailing.`);
    }

    // If the exact sink is a MemberExpression, the property is the name of the column we need to join on.
    if (exactSinkPath.node.type === 'MemberExpression') {
        const sourceModelName = srcPath.node.callee.object.name;
        const sinkModelName = sinkPath.node.callee.object.name;
        
        const sourceColName = exactSinkPath.node.property.name;
        // const sinkColName = ... actually, we already figured this out earlier.

        // 1. Construct the new Sequelize API call
        // 1.1 Construct the parts of the new API call.
        const newWhereClause = t.objectExpression([
            t.objectProperty(
                t.identifier(sourceColName), 
                t.callExpression(
                    t.memberExpression(t.identifier(srcVarName), t.identifier('map')), 
                    [t.arrowFunctionExpression([t.identifier('r')], t.memberExpression(t.identifier('r'), t.identifier(sourceColName)))]))
        ]);

        // We need to check if the source and sink models are associated with a through table.
        // If so, we need to ensure that none of the through table attributes make it into the results.
        // I.e., `add through: {attributes: []}` to the include.
        const propertiesForTheInclude = [
            t.objectProperty(t.identifier('model'), t.identifier(sinkModelName)),
            t.objectProperty(t.identifier('attributes'), t.arrayExpression([]))
        ];  

        // Check if the source and sink models are associated with a through table.
        const throughTable = relationships.find(r => r.leftTable === sourceModelName && 
                                                     r.rightTable === sinkModelName &&
                                                     r.through !== null);

        if (throughTable !== undefined) {
            propertiesForTheInclude.push(t.objectProperty(
                t.identifier('through'), t.objectExpression([t.objectProperty(t.identifier('attributes'), t.arrayExpression([]))])
            ));
        }

        const newIncludeClause = t.objectExpression(propertiesForTheInclude);

        const newGroupClause = t.stringLiteral(`${sourceModelName}.${sourceColName}`);

        const newAttributeClause = t.arrayExpression([
            t.stringLiteral(sourceColName),
            t.arrayExpression([
                t.callExpression(
                    t.memberExpression(t.identifier(sequelizeImportName), t.identifier('fn')),
                    [t.stringLiteral('COUNT'), t.callExpression(
                        t.memberExpression(t.identifier(sequelizeImportName), t.identifier('col')),
                        // NOTE: There's a little plural here. That's because Sequelize will, by default, pluralize the model name.
                        [t.stringLiteral(`${sinkModelName}s.${sinkColName}`)])]),
                t.stringLiteral(`${sinkModelName.toLowerCase()}Count`)
            ])
        ]);

        // 1.2. Construct the actual call by putting all these things together. 
        //      (Also, make it an await)
        const newAPICall = t.awaitExpression(t.callExpression(
            t.memberExpression(t.identifier(sourceModelName), t.identifier('findAll')),
            [t.objectExpression([
                t.objectProperty(t.identifier('where'), newWhereClause),
                t.objectProperty(t.identifier('include'), newIncludeClause),
                t.objectProperty(t.identifier('group'), newGroupClause),
                t.objectProperty(t.identifier('attributes'), newAttributeClause)])
            ]
        ));

        // 1.3. Put it in an assigment.
        const newCountVariableName = `${sinkModelName.toLowerCase()}Counts`;
        const newAssignment = t.variableDeclaration('const', [
            t.variableDeclarator(t.identifier(newCountVariableName), newAPICall)
        ]);

        // 2. Construct the new access.
        // TODO: this.
        // let loopVarAccess;
        // switch (loopPath.node.type) {
        //     case 'ForStatement':
        //         // TODO, there are a billion of these.
        //         break;
        //     case 'CallExpression':
        //         const callback = loopPath.node.arguments[0];
        //         loopVarAccess = t.identifier(callback.params[0].name);
        //         break;
        //     default :
        //         // Cry I guess?
        // }

        const newAccessCallToFind = t.callExpression(
            t.memberExpression(t.identifier(newCountVariableName), t.identifier('find')),
            [t.arrowFunctionExpression(
                [t.identifier('r')], 
                t.binaryExpression(
                    '===', 
                    t.memberExpression(t.identifier('r'), t.identifier(sourceColName)), 
                    t.memberExpression(loopElement, t.identifier(sourceColName))))]);
        
        const newAccessRHS = t.memberExpression(
            t.memberExpression(newAccessCallToFind, t.identifier('dataValues')),
            t.identifier(`${sinkModelName.toLowerCase()}Count`));

        // 3. Place and replace the components.
        // 3.1. Place the new API call assignment.
        console.log('==========================================================');
        console.log('Source location:', srcPath.node.loc.start, srcPath.node.loc.end);
        console.log('New assignment:');
        console.log(generate(newAssignment).code);

        // 3.2. Replace the RHS of the old access.
        // 3.2.1. Replace the entire sink with newAccessRHS.
        console.log('Sink location:', sinkPath.node.loc.start, sinkPath.node.loc.end);
        console.log('New sink:');
        sinkPath.replaceWith(newAccessRHS);
        console.log(generate(sinkPath.node).code);
        console.log('==========================================================');

    }

    console.log('TODO: Actually write out the code.');
}

/**
 * Transforms a flow from a findAll into count.
 * @param src the findAll node.
 * @param sink the count node.
 * @param srcVarName the name of the variable that the source is assigned to. This is, of course, assuming that it is assigned to a variable...
 */
function transformFindAllIntoCount(srcPath : any, sinkPath : any) : void {
    // So: the src call node needs to include the model of the second node.
    // And: the sink call needs to change to a lookup in the joined table.
    const src = srcPath.node;
    const sink = sinkPath.node;

    // First, the source.
    // srcObjArg is the object argument passed to the findAll.
    // e.g., Model.findAll({ <-- this thing --> });
    const srcObjArg = src.arguments[0];
    const srcModelName = src.callee.object.name;
    const sinkModelName = sink.callee.object.name;

    // Make the include:
    const newInclude = t.objectExpression([t.objectProperty(t.identifier('model'), t.stringLiteral(sinkModelName))]);

    // Is there already an include?
    const srcProperties : Array<t.ObjectProperty> = srcObjArg.properties;
    let thereWasAnIncludeProperty = false;
    srcProperties.forEach(prop => {
        if (t.isIdentifier(prop.key) && prop.key.name === 'include') {
            thereWasAnIncludeProperty = true;
            // Now, need to check if the sink model is included.
            const includesToProcess = [];
            if (prop.value.type === 'ArrayExpression') {
                prop.value.elements.forEach(e => includesToProcess.push(e));
            } else if (prop.value.type === 'ObjectExpression') {
                includesToProcess.push(prop.value);
            }

            let modelWasAlreadyIncluded = false;
            includesToProcess.forEach(incl => {
                incl.properties.forEach(inclProp => {
                    if ((<t.Identifier> (<t.ObjectProperty> inclProp).key).name === 'model' &&
                    (<t.Identifier> (<t.ObjectProperty> inclProp).value).name === sinkModelName)
                        modelWasAlreadyIncluded = true;
                });    
            });
            if (! modelWasAlreadyIncluded) {
                // Add an include.
                if (prop.value.type === 'ArrayExpression') {
                    // If it's already an array, just add an element.
                    prop.value.elements.push(newInclude);
                } else {
                    // If it wasn't make an array with whatever was there, plus the new include.
                    const oldValue = prop.value;
                    prop.value = t.arrayExpression([(<any> oldValue), newInclude]);
                }
            }
        }
    });

    // If there wasn't an include already, we need to add one.
    if (! thereWasAnIncludeProperty) {
        const newIncludeProp = t.objectProperty(t.identifier('include'), newInclude);
        srcProperties.push(newIncludeProp);
    }

    // Next, the sink:
    // We need to discover if the sink checks anything in its where claus, and if so, translate it.
    const sinkObjArg = sink.arguments[0]; // object passed to Sink.count({<-- this -->});
    const sinkProperties : Array<t.ObjectProperty> = sinkObjArg.properties;
    const whereChecks = [];
    sinkProperties.forEach(prop => {
        if (t.isIdentifier(prop.key) && prop.key.name === 'where') {
            // There is a where claus. What is the check?
            const whereClaus : any = prop.value; // TODO type any...
            // Each property in the where claus should be translated.
            whereClaus.properties.forEach(prop => {
                const includedProp = prop.key;
                const checkedProp = prop.value;

                // From these, construct a boolean check to be inserted into a filter.
                const lhs = t.memberExpression(t.identifier('v'), includedProp);
                const rhs = checkedProp;
                whereChecks.push(t.binaryExpression("===", lhs, rhs));
            });
        }
    });

    // TODO: probably remove the await?
    if (whereChecks.length > 0) {
        // We need a filter.
        // Build the boolean expression, based on the where claus of the sink.
        let filterCheck = whereChecks.pop();
        while (whereChecks.length > 0) {
            filterCheck = t.binaryExpression('&', filterCheck, whereChecks.pop());
        }

        // Create an arrow function expression with the aforementioned check.
        let filterFun = t.arrowFunctionExpression([t.identifier('v')], filterCheck);

        // Create the new line of code.
        // Idea: variableStoringOriginalModel.sinkModel(PLURAL!)[.filter(v => ...)].length;
        // TODO maybe we can figure out a smarter way to get the name of the sink model lol
        // L__> this would be by including a model 'as' some name
        // TODO Also lmao, srcVarName is not what we want here. If it's in a loop, we will need the function argument or wte.
        const srcVarName = 'TODO';
        const newAccessStart = t.memberExpression(t.identifier(srcVarName), t.identifier(sinkModelName + 's'));
        const filterCall = t.callExpression(t.memberExpression(newAccessStart, t.identifier('filter')), [filterFun]);
        const finalAccess = t.memberExpression(filterCall, t.identifier('length'));

        // Finally, update the node.
        sinkPath.replaceWith(finalAccess);

        console.log(generate(finalAccess));
    }

    // TODO: probably remove the await?
}

// Example of findAll before:
//   const users = await User.findAll({
//     attributes: ["id", "username", "avatar", "channelDescription"],
//     where: {
//       username: {
//         [Op.substring]: req.query.searchterm,
//       },
//     },
//   });
//
// after:
//
//   const users = await User.findAll({
//     include : { model: Subscription },
//     attributes: ["id", "username", "avatar", "channelDescription"],
//     where: {
//       username: {
//         [Op.substring]: req.query.searchterm,
//       },
//     },
//   });

// Example of count before:
//   const subscribersCount = await Subscription.count({
//     where: { subscribeTo: channel.id },
//   });
//
// after:
//   const subscribersCount = users.Subscriptions.filter(s => { return s.subscribeTo === channel.id }).length;