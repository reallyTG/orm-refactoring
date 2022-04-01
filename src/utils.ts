
import { readFileSync } from 'fs';
import { CodeQLFlow } from './types';

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

// TODO: Only exporting for debugging purposes. Remove this.
export function locMatchesCodeQLSource(babelLOC, codeQLFlow) : boolean {
    return babelLOC.start.line === codeQLFlow.sourceLineStart &&
           babelLOC.end.line === codeQLFlow.sourceLineEnd
}

// TODO: Only exporting for debugging purposes. Remove this.
export function locMatchesCodeQLSink(babelLOC, codeQLFlow) : boolean {
    return babelLOC.start.line === codeQLFlow.sinkLineStart &&
           babelLOC.end.line === codeQLFlow.sinkLineEnd
}

/**
 * Takes a babelLOC and all **CodeQL** flows, and returns the flow corresponding to the babelLOC, as well as if it is a source or sink.
 * @param babelLOC the babel LOC
 * @param flows an array of flows
 */
 export function getMatchingFlowForLOCCodeQL(babelLOC, flows : CodeQLFlow[]) : {isSource: boolean, flow: any}[] | false {
    const matchingFlows = [];
    for (let i = 0; i < flows.length; i++) {
        const thisFlow = flows[i];

        if (locMatchesCodeQLSource(babelLOC, thisFlow)) {
            matchingFlows.push({isSource: true, flow: thisFlow});
        }
        
        if (locMatchesCodeQLSink(babelLOC, thisFlow)) {
            matchingFlows.push({isSource: false, flow: thisFlow});
        }
    }

    return matchingFlows.length === 0 ? false : matchingFlows;
}

export function parseCodeQLFlowFile(pathToFile) : CodeQLFlow[] {
    const enum Column {
        Source = 0,
        Source_File = 1,
        Source_Start_Ln = 2,
        Source_End_Ln = 3,
        Sink = 4,
        Sink_File = 5,
        Sink_Start_Ln = 6,
        Sink_End_Ln = 7,
        ExactSink = 8
    }

    const fileContents = readFileSync(pathToFile, 'utf-8');
    const splitContents = fileContents.split('\n');

    const flows = [];
    for (const line of splitContents) {
        // Skip header and empty lines.
        if (line.startsWith('\"Source\"') || line.length === 0) continue;

        // Remove all quotes from split string.
        const splitLine = line.split(',').map(s => s.replace(/\"/g, ''));
        const thisFlow = new CodeQLFlow(splitLine[Column.Source],
                                        splitLine[Column.Source_File], 
                                        Number.parseInt(splitLine[Column.Source_Start_Ln]), 
                                        Number.parseInt(splitLine[Column.Source_End_Ln]),
                                        splitLine[Column.Sink],
                                        splitLine[Column.Sink_File],
                                        Number.parseInt(splitLine[Column.Sink_Start_Ln]),
                                        Number.parseInt(splitLine[Column.Sink_End_Ln]),
                                        splitLine[Column.ExactSink]);

        flows.push(thisFlow);
    }

    return flows;
}