'use strict';

/**
 * Basic port of vehicle message processing and types, from DroneKit.
 */

const mavlink = require("./mavlink.js");
const MathUtils = require("./MathUtils.js");
const MavlinkCommands = require("./MavlinkCommands.js");

const TYPE_UNKNOWN = -1;
const TYPE_PLANE = 1;
const TYPE_COPTER = 2;
const TYPE_ROVER = 3;

function d(str) { 
    console.log("Vehicle(D): " + str); 
}

function t(str) {
    console.log("Vehicle(T): " + str);
}

//
// Nested types
//
/** Event constants */
const VehicleEvents = Object.freeze(
    {
        STATE: "state",
        ATTITUDE_UPDATED: "attitude",
        ALTITUDE_UPDATED: "altitude",
        SPEED_UPDATED: "speed",
        LOCATION_UPDATED: "location",
        HOME_UPDATED: "home_updated",
        MODE_UPDATED: "mode_updated",
        BATTERY_UPDATED: "battery_updated",
        ARM_UPDATED: "arm_updated",
        FLYING_UPDATED: "flying_updated",
        FAILSAFE: "failsafe",
        SIGNAL_UPDATED: "signal",
        GPS_COUNT: "gps_count",
        GPS_FIX: "gps_fix",
        PARAM_RECEIVED: "param_received",
        PARAM_REFRESH_COMPLETE: "param_refresh_complete"
    }
);

/** Vehicle type */
const VehicleType = Object.freeze(
    {
        NONE: { type: TYPE_UNKNOWN, name: "None", is: function (t) { return this.type === t.type } },
        PLANE: { type: TYPE_PLANE, name: "Plane", is: function (t) { return this.type === t.type } },
        COPTER: { type: TYPE_COPTER, name: "Copter", is: function(t) { return this.type === t.type } },
        ROVER: { type: TYPE_ROVER, name: "Rover", is: function (t) { return this.type === t.type } },

        values: function() {
            const out = [];

            for(var prop in this) {
                if(this[prop].type) {
                    out.push(this[prop]);
                }
            }

            return out;
        },

        isPlane: function(type) {
            return (type.type === TYPE_PLANE);
        },

        isRover: function(type) {
            return (type.type === TYPE_ROVER);
        },

        isCopter: function(type) {
            return (type.type === TYPE_COPTER);
        }
    }
);

/** Vehicle mode */
const Mode = Object.freeze(
    {
        PLANE_MANUAL: { number: 0, type: TYPE_PLANE, name: "Manual" },
        PLANE_CIRCLE: { number: 1, type: TYPE_PLANE, name: "Circle" },
        PLANE_STABILIZE: { number: 2, type: TYPE_PLANE, name: "Stabilize" },
        PLANE_TRAINING: { number: 3, type: TYPE_PLANE, name: "Training" },
        PLANE_ACRO: { number: 4, type: TYPE_PLANE, name: "Acro" },
        PLANE_FLY_BY_WIRE_A: { number: 5, type: TYPE_PLANE, name: "FBW A" },
        PLANE_FLY_BY_WIRE_B: { number: 6, type: TYPE_PLANE, name: "FBW B" },
        PLANE_CRUISE: { number: 7, type: TYPE_PLANE, name: "Cruise" },
        PLANE_AUTOTUNE: { number: 8, type: TYPE_PLANE, name: "Autotune" },
        PLANE_AUTO: { number: 10, type: TYPE_PLANE, name: "Auto" },
        PLANE_RTL: { number: 11, type: TYPE_PLANE, name: "RTL" },
        PLANE_LOITER: { number: 12, type: TYPE_PLANE, name: "Loiter" },
        PLANE_GUIDED: { number: 15, type: TYPE_PLANE, name: "Guided" },

        COPTER_STABILIZE: { number: 0, type: TYPE_COPTER, name: "Stabilize" },
        COPTER_ACRO: { number: 1, type: TYPE_COPTER, name: "Acro" },
        COPTER_ALT_HOLD: { number: 2, type: TYPE_COPTER, name: "Alt Hold" },
        COPTER_AUTO: { number: 3, type: TYPE_COPTER, name: "Auto" },
        COPTER_GUIDED: { number: 4, type: TYPE_COPTER, name: "Guided" },
        COPTER_LOITER: { number: 5, type: TYPE_COPTER, name: "Loiter" },
        COPTER_RTL: { number: 6, type: TYPE_COPTER, name: "RTL" },
        COPTER_CIRCLE: { number: 7, type: TYPE_COPTER, name: "Circle" },
        COPTER_LAND: { number: 9, type: TYPE_COPTER, name: "Land" },
        COPTER_DRIFT: { number: 11, type: TYPE_COPTER, name: "Drift" },
        COPTER_SPORT: { number: 13, type: TYPE_COPTER, name: "Sport" },
        COPTER_FLIP: { number: 14, type: TYPE_COPTER, name: "Flip" },
        COPTER_AUTOTUNE: { number: 15, type: TYPE_COPTER, name: "Autotune" },
        COPTER_POSHOLD: { number: 16, type: TYPE_COPTER, name: "Pos Hold" },
        COPTER_BRAKE: { number: 17, type: TYPE_COPTER, name: "Brake" },
        COPTER_THROW: { number: 18, type: TYPE_COPTER, name: "Throw" },
        COPTER_AVOID: { number: 19, type: TYPE_COPTER, name: "Avoid ADSB" },
        COPTER_GUIDED_NOGPS: { number: 20, type: TYPE_COPTER, name: "Guided NoGPS" },
        COPTER_SMART_RTL: { number: 21, type: TYPE_COPTER, name: "Smart RTL" },

        ROVER_MANUAL: { number: 0, type: TYPE_ROVER, name: "Manual" },
        ROVER_ACRO: { number: 1, type: TYPE_ROVER, name: "Acro" },
        ROVER_LEARNING: { number: 2, type: TYPE_ROVER, name: "Learning" },
        ROVER_STEERING: { number: 3, type: TYPE_ROVER, name: "Steering" },
        ROVER_HOLD: { number: 4, type: TYPE_ROVER, name: "Hold" },
        ROVER_AUTO: { number: 10, type: TYPE_ROVER, name: "Auto" },
        ROVER_RTL: { number: 11, type: TYPE_ROVER, name: "RTL" },
        ROVER_SMART_RTL: { number: 12, type: TYPE_ROVER, name: "Smart RTL" },
        ROVER_GUIDED: { number: 15, type: TYPE_ROVER, name: "Guided" },
        ROVER_INITIALIZING: { number: 16, type: TYPE_ROVER, name: "Initializing" },

        UNKNOWN: { number: -1, type: TYPE_UNKNOWN, name: "Unknown"},

        valuesForType: function (type) {
            const out = [];

            for (var prop in this) {
                const val = this[prop];
                if (val && val.type && val.type === type) {
                    out.push(val);
                }
            }

            return out;
        }
    }
);

var mSysId = 1;
var mCompId = 1;
const mEventListeners = [];

// Our vehicle state. Updated in response to Mavlink messages.
const mState = {
    vehicleType: VehicleType.TYPE_UNKNOWN,
    mode: Mode.UNKNOWN,
    speed: 0,
    location: { lat: 0, lng: 0, altMSL: 0, altAGL: 0, valid: false },
    attitude: { roll: 0, rollSpeed: 0, pitch: 0, pitchSpeed: 0, yaw: 0, yawSpeed: 0 },
    gps: { satellites: 0, eph: 0, fixType: 0, valid: false },
    home: { lat: 0, lng: 0, valid: false },
    armed: false,
    flying: false,
    failsafe: false
};

// Vehicle params
const mVehicleParams = { };

// Message mapping to handler functions
const mMessageMap = {
    "HEARTBEAT": processHeartbeat,
    "ATTITUDE": processAttitude,
    "VFR_HUD": processVfrHud,
    "GLOBAL_POSITION_INT": processGlobalPositionInt,
    "RADIO_STATUS": processRadioStatus,
    "BATTERY_STATUS": processBatteryUpdate,
    "GPS_RAW_INT": processGpsRawInt,
    "PARAM_VALUE": processParamValue
};

var mMavlinkSendCallback = null;

function setMavlinkSendCallback(callback) {
    mMavlinkSendCallback = callback;
}

function getVehicleMavlinkMessages() {
    const out = [];

    for(var prop in mMessageMap) {
        out.push(prop);
    }

    return out;
}

/** Set sysid/compid (defaults are 1/1) */
function setIds(sysid, compid) {
    mSysId = sysid;
    mCompId = compid;
}

function setSysId(sysid) { mSysId = sysid; }

function setCompId(compid) { mCompId = compid; }

function isCopter(type) {
    return VehicleType.COPTER.is(type);
}

function isPlane(type) {
    return VehicleType.PLANE.is(type);
}

function isRover(type) {
    return VehicleType.ROVER.is(type);
}

function setMode(/* VehicleMode */mode, callback) {
    MavlinkCommands.changeVehicleMode(mSysId, mCompId, mode.number, callback || mavlinkCallback);
}

function getState() { 
    return mState;
}

function addEventListener(listener) {
    mEventListeners.push(listener);
}

function removeEventListener(listener) {
    const idx = mEventListeners.indexOf(listener);
    if(idx !== -1) {
        mEventListeners.splice(idx, 1);
    }
}

function getParameter(id) {
    return mVehicleParams[id];
}

function getParameterValue(id, defValue) {
    const p = getParam(id);
    return (p)? p.value: defValue;
}

function refreshParameters(mavlinkCallback) {
    MavlinkCommands.refreshParameters(mSysId, mCompId, mavlinkCallback);
}

function onMavlinkMessage(msg) {
    if(!msg) return;
    if(!msg.name) return;

    const func = mMessageMap[msg.name];
    if(func) {
        func(msg);
    }
}

function toVehicleMode(/* int */ mode, /* int */ type) {
    const values = Mode.valuesForType(type.type);

    for(let i = 0, size = values.length; i < size; ++i) {
        if(mode === values[i].number) {
            return values[i];
        }
    }

    return Mode.UNKNOWN;
}

function toBaseType(/* mavlink.MAV_TYPE */ type) {
    var out = TYPE_UNKNOWN;

    switch(type) {
        case mavlink.MAV_TYPE_GENERIC: out = TYPE_UNKNOWN; break;
        case mavlink.MAV_TYPE_FIXED_WING: out = TYPE_PLANE; break;
        case mavlink.MAV_TYPE_QUADROTOR: out = TYPE_COPTER; break;
        case mavlink.MAV_TYPE_COAXIAL: out = TYPE_COPTER; break;
        case mavlink.MAV_TYPE_HELICOPTER: out = TYPE_COPTER; break;
        case mavlink.MAV_TYPE_GROUND_ROVER: out = TYPE_ROVER; break;
        case mavlink.MAV_TYPE_HEXAROTOR: out = TYPE_COPTER; break;
        case mavlink.MAV_TYPE_OCTOROTOR: out = TYPE_COPTER; break;
        case mavlink.MAV_TYPE_TRICOPTER: out = TYPE_COPTER; break;

        default: {
            out = TYPE_UNKNOWN;
            break;
        }

        // Not actually unknown, but unsupported ATM

        // case mavlink.MAV_TYPE_ANTENNA_TRACKER: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_GCS: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_AIRSHIP: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_FREE_BALLOON: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_ROCKET: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_SURFACE_BOAT: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_SUBMARINE: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_FLAPPING_WING: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_KITE: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_ONBOARD_CONTROLLER: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_DUOROTOR: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_QUADROTOR: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_TILTROTOR: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_RESERVED2: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_RESERVED3: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_RESERVED4: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_VTOL_RESERVED5: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_GIMBAL: out = TYPE_UNKNOWN; break;
        // case mavlink.MAV_TYPE_ADSB: out = TYPE_UNKNOWN; break;
    }

    return out;
}

function toVehicleType(/* mavlink.MAV_TYPE */ type) {
    const types = VehicleType.values();

    const baseType = toBaseType(type);

    for(let i = 0, size = types.length; i < size; ++i) {
        if(types[i].type === baseType) {
            return types[i];
        }
    }

    return VehicleType.TYPE_UNKNOWN;
}

function processHeartbeat(msg) {
    // Ignore HB from the GCS
    if(msg.type == 6) return;

    // Type
    if(!mState.mavlink_vehicle_type) {
        mState.mavlink_vehicle_type = msg.type;
    } else {
        if(mState.mavlink_vehicle_type != msg.type) {
            mState.mavlink_vehicle_type = msg.type;
            // reset vehicle type.
            delete mState.vehicleType;
        }
    }

    if(!mState.vehicleType) {
        const vehicleType = toVehicleType(msg.type);
        d("vehicleType=" + JSON.stringify(vehicleType));

        mState.vehicleType = vehicleType;
    }

    // Mode
    const vehicleMode = toVehicleMode(msg.custom_mode, mState.vehicleType);
    if(mState.mode !== vehicleMode) {
        d("vehicleMode=" + JSON.stringify(vehicleMode));
        mState.mode = vehicleMode;

        notifyEvent(VehicleEvents.MODE_UPDATED, { mode: mState.mode });
    }

    // Flying? Armed?
    const status = msg.system_status;
    const flying = (status === mavlink.MAV_STATE_ACTIVE);
    const armed = ((msg.base_mode & mavlink.MAV_MODE_FLAG_SAFETY_ARMED) == mavlink.MAV_MODE_FLAG_SAFETY_ARMED);
    const failsafe = (
            status === msg.system_status == mavlink.MAV_STATE_CRITICAL
        ||  status === msg.system_status == mavlink.MAV_STATE_EMERGENCY
        );

    if(flying !== mState.flying) {
        mState.flying = flying;
        notifyEvent(VehicleEvents.FLYING_UPDATED, { flying: mState.flying });
    }

    if(armed !== mState.armed) {
        mState.armed = armed;
        notifyEvent(VehicleEvents.ARM_UPDATED, { armed: mState.armed });
    }

    if(failsafe) {
        notifyEvent(VehicleEvents.FAILSAFE, { failsafe: true });
    }

    notifyEvent(VehicleEvents.STATE, mState);
}

function processGpsRawInt(msg) {
    const newEph = (msg.eph / 100.0); // convert from eph(cm) to gps_eph(m)

    const gps = mState.gps;
    if(gps.satellites !== msg.satellites_visible || gps.eph !== newEph) {
        gps.satellites = msg.satellites_visible;
        gps.eph = newEph;
        notifyEvent(VehicleEvents.GPS_COUNT, { count: gps.satellites });
        gps.valid = true;
    }

    if(gps.fixType != msg.fix_type) {
        gps.fixType = msg.fix_type;
        notifyEvent(VehicleEvents.GPS_FIX, { fixType: gps.fixType });
        gps.valid = true;
    }
}

function processParamValue(msg) {
    const param = {
        id: msg.param_id,
        value: msg.param_value,
        type: msg.param_type,
        index: msg.param_index,
        count: msg.param_count
    };

    mVehicleParams[msg.param_id] = param;

    notifyEvent(VehicleEvents.PARAM_RECEIVED, {param});

    if(param.index >= param.count) {
        notifyEvent(VehicleEvents.PARAM_REFRESH_COMPLETE);
    }
}

function processRadioStatus(msg) {
    mState.signal = {
        valid: true,
        rxErrors: (msg.rxerrors & 0xffff),
        fixed: (msg.fixed & 0xffff),
        rssi: SikValueToDB(msg.rssi & 0xff),
        remrssi: SikValueToDB(msg.remrssi & 0xff),
        noise: SikValueToDB(msg.noise & 0xff),
        remnoise: SikValueToDB(msg.remnoise & 0xff),
        txbuf: (msg.txbuf & 0xff)
    }

    notifyEvent(VehicleEvents.SIGNAL_UPDATED, mState.signal);
}

function processGlobalPositionInt(msg) {
    const lat = (msg.lat / 1E7);
    const lng = (msg.lon / 1E7);
    const alt = (msg.alt / 1000);

    const changed = (lat !== mState.location.lat || lng != mState.location.lng);
    const altChanged = (alt != mState.location.altAGL);

    mState.location.lat = lat;
    mState.location.lng = lng;
    mState.location.altMSL = alt;
    mState.location.altAGL = msg.relative_alt / 1000;
    mState.location.alt = mState.location.altAGL;

    mState.location.valid = true;

    if(changed) {
        notifyEvent(VehicleEvents.LOCATION_UPDATED, mState.location);
    }
    
    if(altChanged) {
        notifyEvent(VehicleEvents.ALTITUDE_UPDATED, mState.location);
    }
}

function processVfrHud(msg) {
    var speed = mState.speed;

    if(!speed) {
        speed = {
            airSpeed: msg.airspeed,
            groundSpeed: msg.groundspeed,
            throttle: msg.throttle,
            verticalSpeed: msg.climb
        };

        mState.speed = speed;
        notifyEvent(VehicleEvents.SPEED_UPDATED, mState.speed);
    } else {
        if(speed.groundSpeed !== msg.groundspeed || speed.airSpeed !== msg.airspeed || speed.verticalSpeed !== msg.climb) {
            speed.groundSpeed = msg.groundspeed;
            speed.airSpeed = msg.airspeed;
            speed.verticalSpeed = msg.climb;

            notifyEvent(VehicleEvents.SPEED_UPDATED, mState.speed);
        }
    }
}

function processAttitude(msg) {
    mState.attitude = {
        roll: Math.toDegrees(msg.roll),
        rollSpeed: Math.toDegrees(msg.rollspeed),
        pitch: Math.toDegrees(msg.pitch),
        pitchSpeed: Math.toDegrees(msg.pitchspeed),
        yaw: Math.toDegrees(msg.yaw),
        yawSpeed: Math.toDegrees(msg.yawspeed)
    };

    notifyEvent(VehicleEvents.ATTITUDE_UPDATED, { attitude: mState.attitude });
}

function processBatteryUpdate(msg) {
    if(mState.battery) {
        if(mState.battery.voltage !== msg.voltage || 
           mState.battery.remaining !== msg.remaining ||
           mState.battery.current !== msg.current) {
               mState.battery.current = msg.current;
               mState.battery.voltage = msg.voltage;
               mState.battery.remaining = remaining;

               notifyEvent(VehicleEvents.BATTERY_STATUS, mState.battery);
           }
    } else {
        mState.battery = {
            voltage: msg.voltage,
            current: msg.current,
            remaining: msg.remaining
        };

        notifyEvent(VehicleEvents.BATTERY_STATUS, mState.battery);
    }
}

function doAsync(generator) {
    process.nextTick(generator());
}

function notifyEventAsync(event, extras) {
    doAsync(function() {
        const evt = event;
        const ext = extras;

        return function() {
            for (let i = 0, size = mEventListeners.length; i < size; ++i) {
                const listener = mEventListeners[i];
                if (listener.onDroneEvent) {
                    listener.onDroneEvent(evt, ext);
                }
            }
        };
    });
}

function notifyEventSync(event, extras) {
    for (let i = 0, size = mEventListeners.length; i < size; ++i) {
        const listener = mEventListeners[i];
        if (listener.onDroneEvent) {
            listener.onDroneEvent(event, extras);
        }
    }
}

function notifyEvent(event, extras) {
    // notifyEventSync(event, extras);
    notifyEventAsync(event, extras);
}

function SikValueToDB(/* int */ value) {
    return ((value / 1.9) - 127);
}

function mavlinkCallback(msg) {
    d("mavlinkCallback(): msg.name=" + msg.name);

    if(mMavlinkSendCallback) {
        mMavlinkSendCallback(msg);
    }
}

/**
 * Tell the vehicle to move to a specific point. If speedMs is unspecified, no speed is sent along with the 
 * position.
 * 
 * @param {LatLong or LatLongAlt} point 
 * @returns true if the specified location was valid.
 */
function gotoPoint(point) {
    const valid = isValidLocation(point);
    if(valid) {
        const alt = point.alt || 10; // default altitude, ignored by rovers
        MavlinkCommands.sendGuidedPosition(mSysId, mCompId, point.lat, point.lng, alt, mavlinkCallback);
    }

    return valid;
}

function setROI(point) {
    const valid = isValidLocation(point);
    if(valid) {
        MavlinkCommands.sendSetROI(mSysId, mCompId, point.lat, point.lng, point.alt, mavlinkCallback);
    }
}

function clearROI() {
    MavlinkCommands.sendClearROI(mSysId, mCompId, mavlinkCallback);
}

function sendGuidedVelocity(xVel, yVel, zVel) {
    MavlinkCommands.sendGuidedVelocity(mSysId, mCompId, xVel, yVel, zVel, mavlinkCallback);
}

function sendVelocityLocalNed(xVel, yVel, zVel) {
    MavlinkCommands.sendVelocityInLocalFrame(mSysId, mCompId, xVel, yVel, zVel, mavlinkCallback);
}

function setSpeed(speed) {
    d("setSpeed(): speed=" + speed);
    MavlinkCommands.setSpeed(mSysId, mCompId, speed, mavlinkCallback);
}

function isValidLocation(pt) {
    return (pt && pt.lat && pt.lng);
}

module.exports.Type = VehicleType;
module.exports.Mode = Mode;
module.exports.Events = VehicleEvents;
module.exports.setIds = setIds;
module.exports.setSysId = setSysId;
module.exports.setCompId = setCompId;
module.exports.isCopter = isCopter;
module.exports.isPlane = isPlane;
module.exports.isRover = isRover;
module.exports.setMode = setMode;
module.exports.onMavlinkMessage = onMavlinkMessage;
module.exports.getState = getState;
module.exports.addEventListener = addEventListener;
module.exports.removeEventListener = removeEventListener;
module.exports.getParameter = getParameter;
module.exports.refreshParameters = refreshParameters;
module.exports.getParameterValue = getParameterValue;
module.exports.getVehicleMavlinkMessages = getVehicleMavlinkMessages;
module.exports.setMavlinkSendCallback = setMavlinkSendCallback;
module.exports.gotoPoint = gotoPoint;
module.exports.setSpeed = setSpeed;
module.exports.sendGuidedVelocity = sendGuidedVelocity;
module.exports.setROI = setROI;
module.exports.clearROI = clearROI;
module.exports.sendVelocityLocalNed = sendVelocityLocalNed;

(function () {
    if (!Math.toRadians) {
        Math.toRadians = function (degrees) {
            return degrees * Math.PI / 180;
        }
    }

    if (!Math.toDegrees) {
        Math.toDegrees = function (radians) {
            return radians * 180 / Math.PI;
        }
    }
})();

// Tests
function testTypeIterate() {
    const types = VehicleType.values();

    types.map(function(type) {
        d(type.name);
    });
}

function testModeIterate() {
    function showModesFor(type) {
        const modes = Mode.valuesForType(type.type);

        d("Modes for " + type.name);
        modes.map(function(mode) {
            d(JSON.stringify(mode));
        });
    }

    const types = VehicleType.values();
    for(let i = 0, size = types.length; i < size; ++i) {
        showModesFor(types[i]);
    }
}

function testSetVehicleMode() {
    setMode(Mode.COPTER_AUTO, mavlinkCallback);
}

function testMessages() {
    for(let prop in mMessageMap) {
        onMavlinkMessage({name: prop});
    }
}

function testGetVehicleMode() {
    const base_type = 10; // mav_type rover
    const custom_mode = 4; // mav_type rover, mode HOLD

    const vehicleType = toVehicleType(base_type);
    d("vehicleType=" + JSON.stringify(vehicleType));

    const vehicleMode = toVehicleMode(custom_mode, vehicleType);
    d("vehicleMode=" + JSON.stringify(vehicleMode));
}

function test() {
    testGetVehicleMode();
    // testTypeIterate();
    // testModeIterate();
    // testSetVehicleMode();
    // testMessages();

    process.exit(0);
}

if(process.argv[1] === __filename) {
    d("Running tests");
    test();
}
