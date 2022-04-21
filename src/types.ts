
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

    static numFlows = 0;
    UID : number

    type : string
    location : FlowLocation
    name : string

    constructor(type, location, name) {
        this.UID = Flow.numFlows++;
        this.type = type;
        this.location = location;
        this.name = name;
    }

    static emptyFlow() : Flow {
        return new Flow('uninitizalized', FlowLocation.emptyFlowLocation(), 'uninitialized');
    }
}

export class CodeQLFlow {
    static seen : number = 0
    UID : number

    sourceType : string
    sourceFile : string
    sourceLineStart : number
    sourceLineEnd : number

    sinkType : string
    sinkFile : string
    sinkLineStart : number
    sinkLineEnd : number

    exactSink : string;
    exactSinkStartLine : number;
    exactSinkEndLine : number;
    exactSinkStartCol : number;
    exactSinkEndCol : number;

    constructor(sourceType, sourceFile, sourceLineStart, sourceLineEnd, sinkType, sinkFile, sinkLineStart, sinkLineEnd, exactSink, exactSinkStartLine, exactSinkEndLine, exactSinkStartCol, exactSinkEndCol) {
        this.UID = CodeQLFlow.seen++;
        this.sourceType = sourceType;
        this.sourceFile = sourceFile;
        this.sourceLineStart = sourceLineStart;
        this.sourceLineEnd = sourceLineEnd;
        this.sinkType = sinkType;
        this.sinkFile = sinkFile;
        this.sinkLineStart = sinkLineStart;
        this.sinkLineEnd = sinkLineEnd;
        this.exactSink = exactSink;
        this.exactSinkStartLine = exactSinkStartLine;
        this.exactSinkEndLine = exactSinkEndLine;
        this.exactSinkStartCol = exactSinkStartCol;
        this.exactSinkEndCol = exactSinkEndCol;
    }
}

export class Relationship {
    leftTable : string
    rightTable : string
    foreignKey : string

    through : null | string

    constructor(leftTable, rightTable, foreignKey, through = null) {
        this.leftTable = leftTable;
        this.rightTable = rightTable;
        this.foreignKey = foreignKey;
        this.through = through;
    }
}

export class Model {
    name : string
    fields : string[]
    relationships : Relationship[]
    primaryKey : string
 
    constructor(name, fields, primaryKey, relationships) {
        this.name = name;
        this.fields = fields;
        this.primaryKey = primaryKey;
        this.relationships = relationships;
    }

    addRelationship(relationship) {
        this.relationships.push(relationship);
    }
}