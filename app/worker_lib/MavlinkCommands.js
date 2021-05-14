'use strict';

/**
 * Mavlink utilities
 */

const mavlink = require("./mavlink.js");

const EMERGENCY_DISARM_MAGIC_NUMBER = 21196;

const MAVLINK_SET_POS_TYPE_MASK_POS_IGNORE = ((1 << 0) | (1 << 1) | (1 << 2));
const MAVLINK_SET_POS_TYPE_MASK_VEL_IGNORE = ((1 << 3) | (1 << 4) | (1 << 5));
const MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE = ((1 << 6) | (1 << 7) | (1 << 8));
const MAVLINK_SET_POS_TYPE_MASK_YAW_IGNORE = (1 << 10);

function sendSetROI(sysid, compid, lat, lng, alt, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, 
        mavlink.MAV_CMD_DO_SET_ROI,
        0, // confirmation,
        0, 
        0, 
        0, 
        0, 
        lat, 
        lng, 
        alt || 1
    );

    callback(msg);
}

function sendClearROI(sysid, compid, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid,
        mavlink.MAV_CMD_DO_SET_ROI,
        0, // confirmation,
        0,
        0,
        0,
        0,
        0,
        0,
        0
    );

    callback(msg);
}

function changeMissionSpeed(sysid, compid, speed, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, 
        mavlink.MAV_CMD_DO_CHANGE_SPEED,
        0, // confirmation,
        0, 
        speed, 
        0, 
        0, 
        0, 
        0, 
        0
    );

    callback(msg);
}

function setGuidedMode(sysid, compid, lat, lng, d, callback) {
    const msg = new mavlink.messages.mission_item(
        sysid,
        compid,
        0, // seq
        mavlink.MAV_FRAME_GLOBAL, // frame
        mavlink.MAV_CMD_NAV_WAYPOINT, // command
        2, // current (TODO use GUIDED enum)
        1, // autocontinue
        0, // param1
        0, // param2
        0, // param3
        0, // param4
        lat, // x
        lng, // y
        d // z
    );

    callback(msg);
}

function sendGuidedPosition(sysid, compid, lat, lng, alt, callback) {
    const msg = new mavlink.messages.set_position_target_global_int(
        0, // time_boot_ms
        sysid,
        compid,
        mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, // coordinate_frame
        MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE | MAVLINK_SET_POS_TYPE_MASK_VEL_IGNORE | MAVLINK_SET_POS_TYPE_MASK_YAW_IGNORE, // type_mask
        (lat * 1E7), // lat_int
        (lng * 1E7), // lon_int
        alt,
        0, // vx
        0, // vy
        0, // vz
        0, // afx
        0, // afy
        0, // afz
        0, // yaw
        0  // yaw_rate
    );

    callback(msg);
}

function sendGuidedPosInfo(sysid, compid, pos, callback) {
    let flags = MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE;

    if(pos.yaw == null) {
        flags |= MAVLINK_SET_POS_TYPE_MASK_YAW_IGNORE;
    }

    const speed = post.speed || 0;
    if(pos.speed == null) {
        flags |= MAVLINK_SET_POS_TYPE_MASK_VEL_IGNORE;
    }

    const msg = new mavlink.messages.set_position_target_global_int(
        0, // time_boot_ms
        sysid,
        compid,
        mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, // coordinate_frame
        flags, // type_mask
        (lat * 1E7), // lat_int
        (lng * 1E7), // lon_int
        alt,
        speed, // vx
        speed, // vy
        0, // vz
        0, // afx
        0, // afy
        0, // afz
        pos.yaw || 0, // yaw
        pos.yaw_rate || 0  // yaw_rate
    );

    callback(msg);
}

function sendGuidedVelocity(sysid, compid, xVel, yVel, zVel, callback) {
    const msg = new mavlink.messages.set_position_target_global_int(
        0, // time_boot_ms
        sysid,
        compid,
        mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, // coordinate_frame
        MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE | MAVLINK_SET_POS_TYPE_MASK_POS_IGNORE, // type_mask
        0, // lat_int
        0, // lon_int
        0, // alt
        xVel, // vx
        yVel, // vy
        zVel, // vz
        0, // afx
        0, // afy
        0, // afz
        0, // yaw
        0  // yaw_rate
    );

    callback(msg);
}

function sendVelocityInLocalFrame(sysid, compid, xVel, yVel, zVel, callback) {
    const msg = new mavlink.messages.set_position_target_local_ned(
        0, // time_boot_msg
        sysid, 
        compid,
        mavlink.MAV_FRAME_LOCAL_NED, // coordinate_frame
        MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE | MAVLINK_SET_POS_TYPE_MASK_POS_IGNORE | MAVLINK_SET_POS_TYPE_MASK_YAW_IGNORE, // type_mask
        0, // x
        0, // y
        0, // z
        xVel, // vx
        yVel, // vy
        zVel, // vz
        0, // afx
        0, // afy
        0, // afz
        0, // yaw
        0  // yaw_rate
    );

    callback(msg);
}

function setSpeed(sysid, compid, speedMs, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, 
        compid, 
        mavlink.MAV_CMD_DO_CHANGE_SPEED,
        0, // confirmation,
        1, // type: ground speed
        speedMs, 
        0, 0, 0, 0, 0 // unused params
        );

    callback(msg);
}

function sendGuidedPosAndVelocity(sysid, compid, lat, lng, alt, xVel, yVel, zVel, callback) {
    const msg = new mavlink.messages.set_position_target_global_int(
        0, // time_boot_ms
        sysid,
        compid,
        mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, // coordinate_frame
        MAVLINK_SET_POS_TYPE_MASK_ACC_IGNORE | MAVLINK_SET_POS_TYPE_MASK_POS_IGNORE, // type_mask
        (lat * 1E7), // lat_int
        (lng * 1E7), // lon_int
        alt, // alt
        xVel, // vx
        yVel, // vy
        zVel, // vz
        0, // afx
        0, // afy
        0, // afz
        0, // yaw
        0  // yaw_rate
    );

    callback(msg);
}

function changeVehicleMode(sysid, compid, modeNumber, callback) {
    const msg = new mavlink.messages.command_long(
        sysid,
        compid,
        mavlink.MAV_CMD_DO_SET_MODE,
        0, // confirmation,
        mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, // param1
        modeNumber, // param2
        0, 0, 0, 0, 0 // unused params
    );

    callback(msg);
}

function setYaw(sysid, compid, targetAngle, yawRate, clockwise, relative, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, mavlink.MAV_CMD_CONDITION_YAW,
        0, // confirmation,
        targetAngle, yawRate,
        (clockwise)? 1: -1,
        (relative)? 1: 0,
        0, 0, 0
    );

    callback(msg);
}

function sendSetYaw(sysid, compid, angle, direction, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid,
        mavlink.MAV_CMD_CONDITION_YAW,
        0, // confirmation,
        angle,
        10, // deg/s
        direction, // -1 ccw, 1 cw
        0, // absolute
        0,
        0,
        0
    );

    callback(msg);
}

function sendTakeoff(sysid, compid, alt, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, mavlink.MAV_CMD_NAV_TAKEOFF,
        0, // confirmation,
        0, 0, 0, 0, 0, 0, alt
    );

    callback(msg);
}

function sendLand(sysid, compid, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, mavlink.MAV_CMD_NAV_LAND,
        0, // confirmation,
        0, 0, 0, 0, 0, 0, 0
    );

    callback(msg);
}

function sendRTL(sysid, compid, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
        0, // confirmation,
        0, 0, 0, 0, 0, 0, 0
    );

    callback(msg);
}

function sendPause(sysid, compid, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid, 
        mavlink.MAV_CMD_OVERRIDE_GOTO,
        0, // confirmation,
        mavlink.MAV_GOTO_DO_HOLD, 
        mavlink.MAV_GOTO_HOLD_AT_CURRENT_POSITION, 
        0, 
        0, 
        0, 
        0, 
        0
    );

    callback(msg);
}

function sendArm(sysid, compid, arm, emergency, callback) {
    const msg = new mavlink.messages.command_long(
        sysid, compid,
        mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, // confirmation,
        (arm)? 1: 0,
        (emergency)? EMERGENCY_DISARM_MAGIC_NUMBER: 0,
        0,
        0,
        0,
        0,
        0
    );

    callback(msg);
}

function refreshParameters(sysid, compid, callback) {
    const msg = new mavlink.messages.param_request_list(sysid, compid);
    callback(msg);
}

function requestParamRead(sysid, compid, paramid, callback) {
    const msg = new mavlink.messages.param_request_read(sysid, compid, paramid, -1);
    callback(msg);
}

exports.setStreamRates = (sysid, compid, rates, sendCallback) => {
    function requestDataStream(streamId, rate) {
        // d(`requestDataStream(${streamId}, ${rate})`);
        const msg = new mavlink.messages.request_data_stream(sysid, compid, streamId, rate, (rate > 0) ? 1 : 0);
        sendCallback(msg);
    }

    requestDataStream(mavlink.MAV_DATA_STREAM_RAW_SENSORS, rates.rawSensors);
    requestDataStream(mavlink.MAV_DATA_STREAM_EXTENDED_STATUS, rates.extStatus);
    requestDataStream(mavlink.MAV_DATA_STREAM_RC_CHANNELS, rates.rcChannels);
    requestDataStream(mavlink.MAV_DATA_STREAM_RAW_CONTROLLER, rates.rawController);
    requestDataStream(mavlink.MAV_DATA_STREAM_POSITION, rates.position);
    requestDataStream(mavlink.MAV_DATA_STREAM_EXTRA1, rates.extra1);
    requestDataStream(mavlink.MAV_DATA_STREAM_EXTRA2, rates.extra1);
    requestDataStream(mavlink.MAV_DATA_STREAM_EXTRA3, rates.extra1);
}

// exports
exports.sendSetROI = sendSetROI;
exports.sendClearROI = sendClearROI;
exports.changeMissionSpeed = changeMissionSpeed;
exports.setSpeed = setSpeed;
exports.setGuidedMode = setGuidedMode;
exports.sendGuidedPosition = sendGuidedPosition;
exports.sendGuidedPosInfo = sendGuidedPosInfo;
exports.sendGuidedVelocity = sendGuidedVelocity;
exports.sendVelocityInLocalFrame = sendVelocityInLocalFrame;
exports.sendGuidedPosAndVelocity = sendGuidedPosAndVelocity;
exports.changeVehicleMode = changeVehicleMode;
exports.setYaw = setYaw;
exports.sendSetYaw = sendSetYaw;
exports.sendTakeoff = sendTakeoff;
exports.sendLand = sendLand;
exports.sendArm = sendArm;
exports.sendPause = sendPause;
exports.sendRTL = sendRTL;
exports.refreshParameters = refreshParameters;
exports.requestParamRead = requestParamRead;

function mavlinkCallback(msg) {
    console.log(__filename + ": msg=" + JSON.stringify(msg));
}

function testYaw() {
    setYaw(1, 1, 120, 3, true, false, mavlinkCallback);
}

function test() {
    // testModeIterate();
    // testSetVehicleMode();
    testYaw();
}

if(process.mainModule === module) {
    test();
    process.exit(0);
}
