
/**
 * Type corresponding to a location specified in a flow.
 */
export class FlowLocation {
    fileName : string
    pos : {
        start : number[],
        end : number[]
    }

    constructor(fileName, pos) {
        this.fileName = fileName;
        this.pos = pos;
    }

    static emptyFlowLocation() : FlowLocation {
        return new FlowLocation('example', {
            start : [],
            end : []
        });
    }
}

/** 
* The structure of a flow object. 
*/
export class Flow {
    UID : number
    type : string
    location : FlowLocation
    name : string

    constructor(UID, type, location, name) {
        this.UID = UID;
        this.type = type;
        this.location = location;
        this.name = name;
    }

    static emptyFlow() : Flow {
        return new Flow(-1, 'uninitizalized', FlowLocation.emptyFlowLocation(), 'uninitialized');
    }
}