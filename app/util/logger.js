"use strict";

function v(tag, msg) {
    console.log(tag, msg);
}

function e(tag, err) {
    console.log(tag, err);
    console.error(err);
}

exports.v = v;
exports.e = e;

