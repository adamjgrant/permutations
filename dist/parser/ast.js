"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeType = void 0;
var NodeType;
(function (NodeType) {
    NodeType[NodeType["ROOT"] = 0] = "ROOT";
    NodeType[NodeType["TEXT"] = 1] = "TEXT";
    NodeType[NodeType["CHOICE"] = 2] = "CHOICE";
    NodeType[NodeType["ASSIGNMENT"] = 3] = "ASSIGNMENT";
    NodeType[NodeType["VARIABLE_REF"] = 4] = "VARIABLE_REF";
    NodeType[NodeType["SPLAT_REF"] = 5] = "SPLAT_REF";
    NodeType[NodeType["FLAG"] = 6] = "FLAG";
    NodeType[NodeType["INTERPOLATION"] = 7] = "INTERPOLATION";
    NodeType[NodeType["IMPORT"] = 8] = "IMPORT";
})(NodeType || (exports.NodeType = NodeType = {}));
//# sourceMappingURL=ast.js.map