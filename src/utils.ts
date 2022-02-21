/**
 * Matches a babelLOC with a LOC from a flow. Includes a one col adjustment since locations are off by one column.
 * @param babelLOC the babel LOC.
 * @param flowPos the pos element from the flow JSON.
 * @returns true if they match; false otherwise. If babelLOC is undefined, also returns false. 
 */
export function locMatches(babelLOC, flowPos) : boolean {
    if (babelLOC === undefined) return false;

    return babelLOC.start.line === flowPos.start[0] &&
    (babelLOC.start.column + 1) === flowPos.start[1] &&
    babelLOC.end.line === flowPos.end[0] &&
    (babelLOC.end.column + 1) === flowPos.end[1]
}

/**
 * Takes a babelLOC and all flows, and returns the flow corresponding to the babelLOC, as well as if it is a source or sink.
 * @param babelLOC the babel LOC
 * @param flows an array of flows
 */
export function getMatchingFlowForLOC(babelLOC, flows) : {isSource: boolean, flow: any} | false {
    for (let i = 0; i < flows.length; i++) {
        const src = flows[i].source;
        const sink = flows[i].sink;

        if (locMatches(babelLOC, src.location.pos))
            return {isSource: true, flow: src};
        
        if (locMatches(babelLOC, sink.location.pos))
            return {isSource: false, flow: sink};
    }

    return false;
}