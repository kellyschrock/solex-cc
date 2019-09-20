'use strict';

/**
 * Basic vehicle utility functions
 */

const Vehicle = require("./Vehicle.js");

function d(str) { 
    console.log("Vehicle(D): " + str); 
}

function t(str) {
    console.log("Vehicle(T): " + str);
}

function getState() {
    return Vehicle.getState();
}

function getGroundSpeed() {
    const state = getState();
    return (state && state.speed)? state.speed.groundSpeed: 0;
}

function getAirSpeed() {
    const state = getState();
    return (state && state.speed) ? state.speed.airSpeed: 0;
}

function getVerticalSpeed() {
    const state = getState();
    return (state && state.speed) ? state.speed.verticalSpeed: 0;
}

function getGuidedModeFor(vehicleType) {
    if(Vehicle.isCopter(vehicleType)) {
        return Vehicle.Mode.COPTER_GUIDED;
    } else if (Vehicle.isPlane(vehicleType)) {
        return Vehicle.Mode.PLANE_GUIDED;
    } else if(Vehicle.isRover(vehicleType)) {
        return Vehicle.Mode.ROVER_GUIDED;
    } else {
        return Vehicle.Mode.UNKNOWN;
    }
}

function getPauseModeFor(vehicleType) {
    if(Vehicle.isCopter(vehicleType)) {
        return Vehicle.Mode.COPTER_LOITER;
    } else if(Vehicle.isPlane(vehicleType)) {
        return Vehicle.Mode.PLANE_LOITER;
    } else if(Vehicle.isRover(vehicleType)) {
        return Vehicle.Mode.ROVER_HOLD;
    } else {
        return Vehicle.Mode.UNKNOWN;
    }
}

exports.getState = getState;
exports.getAirSpeed = getAirSpeed;
exports.getGroundSpeed = getGroundSpeed;
exports.getVerticalSpeed = getVerticalSpeed;
exports.getGuidedModeFor = getGuidedModeFor;
exports.getPauseModeFor = getPauseModeFor;

function test() {
    getAirSpeed();
    getGroundSpeed();
    getVerticalSpeed();

    const types = [Vehicle.Type.COPTER, Vehicle.Type.PLANE, Vehicle.Type.ROVER];
    for(var i = 0, size = types.length; i < size; ++i) {
        const pauseMode = getPauseModeFor(types[i]);
        const runMode = getGuidedModeFor(types[i]);
        console.log("type=" + types[i].name + " pauseMode=" + pauseMode.name + " runMode=" + runMode.name);
    }
}

if (process.argv[1] === __filename) {
    d("Running tests");
    test();
    process.exit(0);
}

