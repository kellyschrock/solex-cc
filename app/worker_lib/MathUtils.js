'use strict';

/**
 * Port of MathUtils functions from DroneKit.
 */

const RADIUS_OF_EARTH_IN_METERS = 6378137.0;  // Source: WGS84

/**
 * Computes the distance between two points taking into consideration altitude. If either of the locations
 * doesn't have an altitude, 2D distance is used instead.
 * @param from  start lat/long position
 * @param to    end lat/long position
 * @return      distance between positions in meters.
 */
function getDistance3D(/* LatLongAlt */ from, /* LatLongAlt */ to) {
    if (from == null || to == null) {
        return -1;
    }

    const distance2d = getDistance2D(from, to);

    if(from.alt && to.alt && (from.alt !== to.alt)) {
        const distanceSqr = Math.pow(distance2d, 2);
        const altitudeSqr = Math.pow(to.alt - from.alt, 2);

        return Math.sqrt(altitudeSqr + distanceSqr);
    } else {
        return distance2d;
    }
}

/**
 * Computes the distance between two points without considering altitude.
 * @param from  start lat/long position
 * @param to    end lat/long position
 * @return      distance between positions in meters.
 */
function getDistance2D(/* LatLong */ from, /* LatLong */ to) {
    if (from == null || to == null) {
        return -1;
    }

    return RADIUS_OF_EARTH_IN_METERS * Math.toRadians(getArcInRadians(from, to));
}

function getArcInRadians(/* LatLong */ from, /* LatLong */ to) {
    const latitudeArc = Math.toRadians(from.lat - to.lat);
    const longitudeArc = Math.toRadians(from.lng - to.lng);

    var latitudeH = Math.sin(latitudeArc * 0.5);
    latitudeH *= latitudeH;

    var lontitudeH = Math.sin(longitudeArc * 0.5);
    lontitudeH *= lontitudeH;

    const tmp = Math.cos(Math.toRadians(from.lat))
        * Math.cos(Math.toRadians(to.lat));
        
    return Math.toDegrees(2.0 * Math.asin(Math.sqrt(latitudeH + tmp * lontitudeH)));
}

function normalize(/* double */ value, /* double */ min, /* double */ max) {
    value = constrain(value, min, max);
    return (value - min) / (max - min);

}

function constrain(/* double */ value, /* double */ min, /* double */ max) {
    value = Math.max(value, min);
    value = Math.min(value, max);
    return value;
}

function angleDiff(/* double */ a, /* double */ b) {
    const diff = Math.IEEEremainder(b - a + 180, 360);
    if (diff < 0)
        diff += 360;
    return diff - 180;
}

function constrainAngle(/* double */ x) {
    x = Math.IEEEremainder(x, 360);
    if (x < 0)
        x += 360;
    return x;
}

function bisectAngle(/* double */ a, /* double */ b, /* double */ alpha) {
    return constrainAngle(a + angleDiff(a, b) * alpha);
}

function hypot(/* double */ altDelta, /* double */ distDelta) {
    return Math.hypot(altDelta, distDelta);
}

function dcmFromEuler(/* double */ roll, /* double */ pitch, /* double */ yaw) {
    var dcm = [3][3];
    // double dcm[][] = new double[3][3];

    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const sr = Math.sin(roll);
    const cr = Math.cos(roll);
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);

    dcm[0][0] = cp * cy;
    dcm[1][0] = (sr * sp * cy) - (cr * sy);
    dcm[2][0] = (cr * sp * cy) + (sr * sy);
    dcm[0][1] = cp * sy;
    dcm[1][1] = (sr * sp * sy) + (cr * cy);
    dcm[2][1] = (cr * sp * sy) - (sr * cy);
    dcm[0][2] = -sp;
    dcm[1][2] = sr * cp;
    dcm[2][2] = cr * cp;

    return dcm;
}

/**
 * Based on the Ramer–Douglas–Peucker algorithm
 * http://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm
 * @param list      List of lat/long points in the curve.
 * @param epsilon   Tolerance for determining list of points for approximation of curve.
 * @return          List of lat/long points in the approximated curve.
 */
function /* List <LatLong> */ simplify(/* List <LatLong> */ list, /* double */ epsilon) {
    var index = 0;
    var dmax = 0;
    var lastIndex = list.length - 1;

    // Find the point with the maximum distance.
    for (var i = 1; i < lastIndex; i++) {
        var d = pointToLineDistance(list.get(0), list.get(lastIndex), list.get(i));
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    // If max distance is greater than epsilon, recursively simplify.
    const /* List <LatLong> */ ResultList = [];
    if (dmax > epsilon) {
        // Recursive call.
        const recResults1 = simplify(list.slice(0, index + 1), epsilon);
        const recResults2 = simplify(list.slice(index, lastIndex + 1), epsilon);

        // Build the result list.
        recResults1.splice(recResults1.length - 1, 1);
        ResultList.concat(recResults1);
        ResultList.concat(recResults2);
    } else {
        ResultList.add(list[0]);
        ResultList.add(list[lastIndex]);
    }

    return ResultList;
}

/**
 * Provides the distance from a point P to the line segment that passes
 * through A-B. If the point is not on the side of the line, returns the
 * distance to the closest point
 *
 * @param L1    First point of the line
 * @param L2    Second point of the line
 * @param P     Point to measure the distance
 * @return      distance between point and line in meters.
 */
function pointToLineDistance(/* LatLong */ L1, /* LatLong */ L2, /* LatLong */ P) {
    const A = P.lat - L1.lat;
    const B = P.lng - L1.lng;
    const C = L2.lat - L1.lat;
    const D = L2.lng - L1.lng;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    const param = dot / len_sq;

    var xx;
    var yy;

    if (param < 0) // point behind the segment
    {
        xx = L1.latitude;
        yy = L1.longitude;
    } else if (param > 1) // point after the segment
    {
        xx = L2.latitude;
        yy = L2.longitude;
    } else { // point on the side of the segment
        xx = L1.latitude + param * C;
        yy = L1.longitude + param * D;
    }

    return Math.hypot(xx - P.lat, yy - P.lng);
}

/**
 * Computes the heading between two coordinates.
 * @param fromLoc   start lat/long position
 * @param toLoc     end lat/long position
 * @return          heading in degrees
 */
function getHeadingFromCoordinates(/* LatLong */ fromLoc, /* LatLong */ toLoc) {
    const fLat = Math.toRadians(fromLoc.lat);
    const fLng = Math.toRadians(fromLoc.lng);
    const tLat = Math.toRadians(toLoc.lat);
    const tLng = Math.toRadians(toLoc.lng);

    const degree = Math.toDegrees(Math.atan2(
        Math.sin(tLng - fLng) * Math.cos(tLat),
        Math.cos(fLat) * Math.sin(tLat) - Math.sin(fLat) * Math.cos(tLat)
        * Math.cos(tLng - fLng)));

    if (degree >= 0) {
        return degree;
    } else {
        return 360 + degree;
    }
}

/**
 * Extrapolate latitude/longitude given a heading and distance thanks to
 * http://www.movable-type.co.uk/scripts/latlong.html
 *
 * @param origin    Point of origin
 * @param bearing   bearing to navigate
 * @param distance  distance to be added
 * @return          new point with the added distance
 */
function newCoordFromBearingAndDistance(/* LatLong */ origin, /* double */ bearing, /* double */ distance) {
    const lat = origin.lat;
    const lon = origin.lng;
    const lat1 = Math.toRadians(lat);
    const lon1 = Math.toRadians(lon);
    const brng = Math.toRadians(bearing);
    const dr = distance / RADIUS_OF_EARTH_IN_METERS;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));

    return (newLatLong(Math.toDegrees(lat2), Math.toDegrees(lon2)));
}

/**
 * Make a path between the two specified locations, with intermediate locations appearing every jumpDistance.
 * If both points have altitude (alt), then altitudes of intermediate locations are interpolated between them.
 * 
 * @param {LatLong} here 
 * @param {LatLong} there 
 * @param {double} jumpDistance 
 */
function makePathBetween(here, there, jumpDistance) {
    if(!jumpDistance) jumpDistance = 5;
    
    const out = [here];
    const heading = getHeadingFromCoordinates(here, there);
    const totalDistance = getDistance2D(here, there);
    const hasAltitude = (here.alt && there.alt);
    const hereAlt = (hasAltitude)? here.alt: undefined;
    const thereAlt = (hasAltitude)? there.alt: undefined;
    var altStep = undefined;

    if(hasAltitude) {
        const stepSize = (totalDistance / jumpDistance);
        altStep = (thereAlt - hereAlt) / stepSize;
    }

    var pointAlt = hereAlt + altStep;
    var flag = here;
    while(true) {
        const point = newCoordFromBearingAndDistance(flag, heading, jumpDistance);

        if(hasAltitude) {
            point.alt = pointAlt;
            pointAlt += altStep;
        }

        out.push(point);

        if(getDistance2D(point, there) < jumpDistance) {
            break;
        }

        flag = point;
    }

    out.push(there);
    return out;
}

/**
 * Return speed in meters/second (mm/ms) from the specified locations and time between them.
 * 
 * @param {LatLong} here 
 * @param {LatLong} there 
 * @param {long} time 
 */
function getSpeedFrom(here, there, time) {
    const dist = getDistance2D(here, there);
    return (dist * 1000 / time);
}

/**
 * Compute total length of the polyline in meters.
 *
 * @param gridPoints    list of lat/long points for the polyline.
 * @return              length of the polyline in meters.
 */
function getPolylineLength(/* List <LatLong> */ gridPoints) {
    var length = 0;

    for (var i = 1, size = gridPoints.length; i <= size; i++) {
        const to = gridPoints[i-1];
        if (!to) {
            continue;
        }

        length += getDistance2D(gridPoints[i], to);
    }

    return length;
}

function newLatLong(lat, lng) {
    return {
        lat: lat, lng: lng
    };
}

function newLatLongAlt(lat, lng, alt) {
    return {
        lat: lat, lng: lng, alt: alt
    };
}

// exports
exports.getDistance3D = getDistance3D;
exports.getDistance2D = getDistance2D;
exports.getArcInRadians = getArcInRadians;
exports.normalize = normalize;
exports.constrain = constrain;
exports.angleDiff = angleDiff;
exports.constrainAngle = constrainAngle;
exports.bisectAngle = bisectAngle;
exports.hypot = hypot;
exports.dcmFromEuler = dcmFromEuler;
exports.simplify = simplify;
exports.pointToLineDistance = pointToLineDistance;
exports.getHeadingFromCoordinates = getHeadingFromCoordinates;
exports.newCoordFromBearingAndDistance = newCoordFromBearingAndDistance;
exports.makePathBetween = makePathBetween;
exports.getPolylineLength = getPolylineLength;
exports.newLatLong = newLatLong;
exports.newLatLongAlt = newLatLongAlt;
exports.getSpeedFrom = getSpeedFrom;


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

function testDistance2D() {
    // Driveway
    const here = {
        lat: 38.642937,
        lng: -94.342362
    };

    // Just south of the driveway 100ft or so
    const there = {
        lat: 38.642501,
        lng: -94.342366
    };

    const dist = getDistance2D(here, there);
    const bearing = getHeadingFromCoordinates(here, there);

    console.log("2D: dist=" + dist + " bearing=" + bearing);
}

function testDistance3D() {
    // Driveway
    const here = {
        lat: 38.642937,
        lng: -94.342362,
        alt: 10
    };

    const there = newCoordFromBearingAndDistance(here, 180, 100);

    // Just south of the driveway 100ft or so
    // const there = {
    //     lat: 38.642501,
    //     lng: -94.342366,
    //     alt: 100
    // };

    console.log("3D: dist=" + getDistance3D(here, there) + " bearing=" + getHeadingFromCoordinates(here, there));

    there.alt = 50;
    console.log("After alt: dist=" + getDistance3D(here, there), getHeadingFromCoordinates(here, there));
}

function testNewLocations() {
    // Driveway
    const here = {
        lat: 38.642937,
        lng: -94.342362,
        alt: 10
    };

    const newLoc = newCoordFromBearingAndDistance(here, 90, 48);
    console.log("newLoc=" + JSON.stringify(newLoc));

    var heading = getHeadingFromCoordinates(here, newLoc);
    var dist = getDistance2D(here, newLoc);
    console.log("headingToNew=" + heading + " distToNew=" + dist);
}

function testMakePath() {
    // North edge of driveway
    const here = {
        lat: 38.642937,
        lng: -94.342362,
        alt: 100
    };

    // Just south of the driveway 100ft or so
    const there = {
        lat: 38.642501,
        lng: -94.342366,
        alt: 10
    };

    const path = makePathBetween(here, there, 1);

    for(var i = 0, size = path.length; i < size; ++i) {
        console.log(JSON.stringify(path[i]));
    }
}

function testPathLength() {
    // North edge of driveway
    const start = {
        lat: 38.642937,
        lng: -94.342362,
        alt: 10
    };

    const path = [start];

    var dist = 10;
    for(var i = 0; i < 50; ++i) {
        path.push(newCoordFromBearingAndDistance(start, 120, dist));
        dist += 10;
    }

    const pathLen = getPolylineLength(path);
    console.log("pathLen=" + pathLen);
}

function test() {
    // testDistance2D();
    testDistance3D();
    // testNewLocations();
    // testPathLength();
    // testMakePath();
}

if(process.mainModule === module) {
    test();
    process.exit(0);
}

