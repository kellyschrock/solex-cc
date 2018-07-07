'use strict';

const events = require("events");
const jspack = require("jspack").jspack;

/*
Just a module sitting in a worker directory used only by that worker.
*/

function helperFunction(str) {
    console.log(__filename + "::helperFunction(): str=" + str);
}

exports.helperFunction = helperFunction;
