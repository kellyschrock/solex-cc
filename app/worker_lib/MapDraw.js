'use strict';

exports.clearAll = function() {
    return {
        id: "map_clear_all"
    };
}

exports.circleDraw = function(where, radius, borderColor, fillColor, symbolId) {
    return {
        id: "map_draw_circle",
        action: "draw",
        symbol_id: symbolId || makeSymbolId(),
        center: where,
        radius: radius || 20,
        border_color: borderColor || "red",
        fill_color: fillColor || "#11ff0000"
    };
};

exports.circleClear = function(symbolId) {
    return {
        id: "map_draw_circle",
        action: "clear",
        symbol_id: symbolId
    };
}

exports.polyDraw = function(points, borderColor, fillColor, symbolId) {
    return {
        id: "map_draw_polygon",
        action: "draw",
        symbol_id: symbolId || makeSymbolId(),
        points: points,
        border_color: borderColor || "white",
        fill_color: fillColor || "#00000000"
    };
}

exports.polyClear = function (symbolId) {
    return {
        id: "map_draw_poly",
        action: "clear",
        symbol_id: symbolId
    };
}

exports.lineDraw = function(path, color, width, symbolId) {
    return {
        id: "map_draw_line",
        action: "draw",
        symbol_id: symbolId || makeSymbolId(),
        points: path,
        color: color || "#ddff00ff",
        width: width || 2
    };
}

exports.lineAdd = function(path, color, width, symbolId) {
    return {
        id: "map_draw_line",
        action: "add",
        symbol_id: symbolId || makeSymbolId(),
        points: path,
        color: color || "#ddff00ff",
        width: width || 2
    };
}

exports.lineClear = function(symbolId) {
    return {
        id: "map_draw_line",
        action: "clear",
        symbol_id: symbolId
    };
}

function makeSymbolId() {
    return new Date().getTime().toString();
}
