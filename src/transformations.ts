import generate from '@babel/generator'; // For debugging.
import * as t from '@babel/types';

// BIG TODOS
// TODO 1 Parse the model. We might be able to generate better information if we have the model.
// TODO 2 Figure out if we're inside of a function. Actually, **figure out if the model is being looped over**.

// TODO: any is a cop out, figure out a better type.
export function transformPair(srcType : string, sinkType : string, srcVarName : string, src : any, sink : any) : void {
    if (srcType === 'findAll' && sinkType === 'count') {
        transformFindAllIntoCount(src, sink, srcVarName);
    }
}

/**
 * Transforms a flow from a findAll into count.
 * @param src the findAll node.
 * @param sink the count node.
 * @param srcVarName the name of the variable that the source is assigned to. This is, of course, assuming that it is assigned to a variable...
 */
function transformFindAllIntoCount(srcPath : any, sinkPath : any, srcVarName : string) : void {
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