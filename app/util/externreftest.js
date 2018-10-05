'use strict';

// A fake "app" that uses Vehicle.js and others. 

const Vehicle = require("./Vehicle.js");

function d(str) { console.log(__filename + ": " + str); }

function mavlinkCallback(msg) {
    d(JSON.stringify(msg));
}

const eventCallback = {
    onDroneEvent(event, extras) {
        d("onDroneEvent(): event=" + event + " extras=" + JSON.stringify(extras));
    }
};

function doAsync(generator) {
    process.nextTick(generator());
}

function testClosures() {

    function doTest(a, b) {
        doAsync(function() {
            var myA = a;
            var myB = b;
            return function() {
                d("myA=" + myA + " myB=" + myB);
            }
        });
    }

    doTest("a", "b");
    doTest("c", "d");
    doTest("e", "f");

    d("Do some shit on the main thread");
}

function testState() {
    const state = Vehicle.getState();
    const vehicleType = state.type;
    const vehicleMode = state.mode;
    const vehicleSpeed = state.speed;
    const pos = state.location;
    const home = state.home;

    d("state=" + JSON.stringify(state));

    Vehicle.addEventListener(eventCallback);
    Vehicle.setMode(vehicleMode, mavlinkCallback);
}

function test() {
    testClosures();
    // testState();
}

if(process.argv[1] === __filename) {
    test();

    setTimeout(function() {
        process.exit(0);
    }, 3000);
}



