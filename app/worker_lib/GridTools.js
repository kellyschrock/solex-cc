'use strict';

const MathUtils = require("./MathUtils.js");

function LineLatLong(start, end) {
    this.start = start;
    this.end = end;

    this.getHeading = function() { return MathUtils.getHeadingFromCoordinates(this.start, this.end); }
    this.length = function() { return MathUtils.getDistance2D(this.start, this.end); }
    
    this.reversePoints = function() {
        const start = this.start;
        const end = this.end;
        this.start = {lat: end.lat, lng: end.lng};
        this.end = {lat: start.lat, lng: start.lng };
    }

    this.getStart = function () { return this.start; }
    this.getEnd = function () { return this.end; }
    this.getMiddle = function() {
        return MathUtils.newCoordFromBearingAndDistance(this.start, this.getHeading(), this.length() / 2);
    }

    this.getDistanceToEnd = function (where) {
        return MathUtils.getDistance2D(where, this.end);
    }

    this.getDistanceToStart = function (where) {
        return MathUtils.getDistance2D(where, this.start)
    }

    this.getFarthestEndpointTo = function(where) {
        if(this.getDistanceToEnd(where) < this.getDistanceToStart(where)) {
            return this.start;
        } else {
            return this.end;
        }
    }

    this.getClosestEndpointTo = function(where) {
        if(this.getDistanceToStart(where) < this.getDistanceToEnd(where)) {
            return this.start;
        } else {
            return this.end;
        }
    };

    this.midPoint = function() {
        const dist = MathUtils.getDistance2D(this.start, this.end);
        const head = this.getHeading();
        return MathUtils.newCoordFromBearingAndDistance(this.start, head, dist / 2);
    };
}

exports.LineLatLong = LineLatLong;

function Polygon() {
    this.points = [];

    this.addPoints = function(points) {
        points.map((p) => this.points.push(p));
        return this;
    }

    this.addPoint = function(p) {
        this.points.push(p);
        return this;
    }

    this.clearPolygon = function() {
        this.points.splice(0, this.points.length);
        return this;
    }

    this.getPoints = function() { return this.points; }

    this.getLines = function() {
        const list = [];

        for(let i = 0, size = this.points.length; i < size; ++i) {
            const endIndex = (i == 0)? this.points.length - 1: i - 1;
            list.push(new LineLatLong(this.points[i], this.points[endIndex]));
        }

        return list;
    }

    this.movePoint = function(coord, number) {
        this.points[number].lat = coord.lat;
        this.points[number].lng = coord.lng;
        return this;
    }

    this.getArea = function() {
        return MathUtils.getArea(this);
    }

    this.checkIfValid = function() {
        if(this.points.length < 3) throw Error("Need at least 3 points");
        return this;
    }

    this.reversePoints = function() {
        return this.points.reverse();
    }
}

exports.Polygon = Polygon;

function CoordBounds(points) {
	this.sw_3quadrant = null;
    this.ne_1quadrant = null;
    
    this.include = function(point) {
        if(this.sw_3quadrant == null || this.ne_1quadrant == null) {
            this.sw_3quadrant = { lat: point.lat, lng: point.lng };
            this.ne_1quadrant = { lat: point.lat, lng: point.lng };
        } else {
            if (point.lng > this.ne_1quadrant.lng) {
                this.ne_1quadrant.lng = point.lng;
            }
            if (point.lat > this.ne_1quadrant.lat) {
                this.ne_1quadrant.lat = point.lat;
            }
            if (point.lng < this.sw_3quadrant.lng) {
                this.sw_3quadrant.lng = point.lng;
            }
            if (point.lat < this.sw_3quadrant.lat) {
                this.sw_3quadrant.lat = point.lat;
            }
        }
    }

    this.diag = function() {
        return MathUtils.latToMeters(MathUtils.getApproximatedDistance(this.ne_1quadrant, this.sw_3quadrant));
    }

    this.getMiddle = function() {
        return {
            lat: ((this.ne_1quadrant.lat + this.sw_3quadrant.lat) / 2),
            lng: ((this.ne_1quadrant.lng + this.sw_3quadrant.lng) / 2)
        };
    }

    points.map(p => this.include(p));
}

exports.CoordBounds = CoordBounds;

function CircumscribedGrid(points, angle, lineDistance) {
    this.points = points;
    this.angle = angle;
    this.lineDistance = lineDistance;
    this.extrapolatedDiag = 0.0;
    this.grid = [];

    this.drawGrid = function(lineDist) {
        this.grid = [];
        let lines = 0;
        let startPoint = this.gridLowerLeft;

        while ((lines * lineDist) < this.extrapolatedDiag) {
            const endPoint = MathUtils.newCoordFromBearingAndDistance(startPoint, this.angle, this.extrapolatedDiag);
            const line = new LineLatLong(startPoint, endPoint);
            this.grid.push(line);
            startPoint = MathUtils.newCoordFromBearingAndDistance(startPoint, this.angle + 90, lineDist);
            lines++;
        }
    }

    this.findPolygonBounds = function(points) {
        const bounds = new CoordBounds(points);
        const middlePoint = bounds.getMiddle();
        this.gridLowerLeft = MathUtils.newCoordFromBearingAndDistance(middlePoint, angle - 135, bounds.diag());
        this.extrapolatedDiag = bounds.diag() * 1.5;
    }

    this.getGrid = function() { return this.grid; }

    this.findPolygonBounds(points);
    this.drawGrid(lineDistance);
}

exports.CircumscribedGrid = CircumscribedGrid;

function Grid(list, cameraLocations) {
    this.gridPoints = list;
    this.cameraLocations = cameraLocations;

    this.getLength = function() { return MathUtils.getPolylineLength(this.gridPoints); }
    this.getNumberOfLines = function() { return this.gridPoints.length / 2; }
    this.getCameraLocations = function() { return this.cameraLocations; }
    this.getCameraCount = function() { return this.cameraLocations.length; }
}

exports.Grid = Grid;

function GridBuilder(polygon, params, originPoint) {
    this.poly = polygon;
    this.origin = originPoint || { lat: 0, lng: 0 };
    this.angle = params.angle || 0;
    this.lineDistance = params.lineDistance || 2;
    this.wpDistance = params.wpDistance || 2;

    this.grid = null;

    this.generateGrid = function(sort) {
        const polyPoints = this.poly.points;
        const polyLines = this.poly.getLines();
        
        const circumscribedGrid = new CircumscribedGrid(polyPoints, this.angle, this.lineDistance).getGrid();
        const trimmedGrid = new Trimmer(circumscribedGrid, this.poly.getLines()).getTrimmedGrid();
        const gridSorter = new EndpointSorter(trimmedGrid, this.wpDistance);
        gridSorter.sortGrid(this.origin, sort);
        this.grid = new Grid(gridSorter.getSortedGrid(), gridSorter.getCameraLocations());
        return this.grid;
    }
}

exports.GridBuilder = GridBuilder;

const PointTools = {
    findFarthestPoint: function(crosses, middle) {
        let farthest = -1;
        let farthestPoint = null;

        crosses.map(cross => {
            const distance = MathUtils.getDistance2D(cross, middle);
            if (distance > farthest) {
                farthestPoint = cross;
                farthest = distance;
            }
        });

        return farthestPoint;
    },

    /**
     * Finds the closest point in a list to another point
     * 
     * @param point
     *            point that will be used as reference
     * @param list
     *            List of points to be searched
     * @return The closest point
     */
    findClosestPoint: function(point, list) {
        let answer = null;
        let currentBest = Number.MAX_VALUE;

        list.map(pnt => {
            const dist1 = MathUtils.getDistance2D(point, pnt);
            if (dist1 < currentBest) {
                answer = pnt;
                currentBest = dist1;
            }
        });

        return answer;
    },

    /**
     * Finds the pair of adjacent points that minimize the distance to a
     * reference point
     * 
     * @param point
     *            point that will be used as reference
     * @param waypoints2
     *            List of points to be searched
     * @return Position of the second point in the pair that minimizes the
     *         distance
     */
    findClosestPair: function(point, waypoints2) {
        let answer = 0;
        let currentBest = Double.MAX_VALUE;
        let dist;
        let p1, p2;

        for (let i = 0, size = waypoints2.length; i < size; ++i) {
            if (i == waypoints2.length - 1) {
                p1 = waypoints2[i];
                p2 = waypoints2[0];
            } else {
                p1 = waypoints2[i];
                p2 = waypoints2[i + 1];
            }

            const dist = pointToLineDistance(p1, p2, point);
            if (dist < currentBest) {
                answer = i + 1;
                currentBest = dist;
            }
        }

        return answer;
    },

    /**
     * Provides the distance from a point P to the line segment that passes
     * through A-B. If the point is not on the side of the line, returns the
     * distance to the closest point
     * 
     * @param L1
     *            First point of the line
     * @param L2
     *            Second point of the line
     * @param P
     *            Point to measure the distance
     */
    pointToLineDistance: function(L1, L2, P) {
        const A = P.lat - L1.lat;
        const B = P.lng - L1.lng;
        const C = L2.lat - L1.lat;
        const D = L2.lng - L1.lng;

        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        const param = dot / len_sq;

        let xx, yy;

        if (param < 0) // point behind the segment
        {
            xx = L1.lat;
            yy = L1.lng;
        } else if (param > 1) // point after the segment
        {
            xx = L2.lat;
            yy = L2.lng;
        } else { // point on the side of the segment
            xx = L1.lat + param * C;
            yy = L1.lng + param * D;
        }

        return Math.hypot(xx - P.lat, yy - P.lng);
    }
};

exports.PointTools = PointTools;

const LineTools = {
    findExternalPoints: function (crosses) {
        const meanCoord = new CoordBounds(crosses).getMiddle();
        const start = PointTools.findFarthestPoint(crosses, meanCoord);
        const end = PointTools.findFarthestPoint(crosses, start);
        return new LineLatLong(start, end);
    },

    /**
     * Finds the intersection of two lines http://stackoverflow.com/questions/
     * 1119451/how-to-tell-if-a-line-intersects -a-polygon-in-c
     */
    findLineIntersection: function (first, second) {
        const denom = ((first.getEnd().lat - first.getStart().lat) * (second.getEnd().lng - second
            .getStart().lng))
            - ((first.getEnd().lng - first.getStart().lng) * (second.getEnd().lat - second
                .getStart().lat));

        if (denom == 0) return null; // parallel lines

        const numer = ((first.getStart().lng - second.getStart().lng) * (second.getEnd()
            .lat - second.getStart().lat))
            - ((first.getStart().lat - second.getStart().lat) * (second.getEnd().lng - second
                .getStart().lng));

        const r = numer / denom;

        const numer2 = ((first.getStart().lng - second.getStart().lng) * (first.getEnd()
            .lat - first.getStart().lat))
            - ((first.getStart().lat - second.getStart().lat) * (first.getEnd().lng - first
                .getStart().lng));
        const s = numer2 / denom;
        if ((r < 0 || r > 1) || (s < 0 || s > 1)) {
            //No intersection
            return null;
        }
        // Find intersection point
        const x = first.getStart().lat
            + (r * (first.getEnd().lat - first.getStart().lat));
        const y = first.getStart().lng
            + (r * (first.getEnd().lng - first.getStart().lng));
        return { lat: x, lng: y };
    },

    /**
     * Finds the line that has the start or tip closest to a point.
     * 
     * @param point
     *            Point to the distance will be minimized
     * @param list
     *            A list of lines to search
     * @return The closest Line
     */
    findClosestLineToPoint: function (/* LatLong */ point, /* List < LineLatLong > */ list) {
        let /* LineLatLong */ answer = list[0];
        let shortest = Number.MAX_VALUE;

        list.map(line => {
            const ans1 = MathUtils.getDistance2D(point, line.getStart());
            const ans2 = MathUtils.getDistance2D(point, line.getEnd());
            const shorterPt = (ans1 < ans2) ? line.getStart() : line.getEnd();

            if (shortest > MathUtils.getDistance2D(point, shorterPt)) {
                answer = line;
                shortest = MathUtils.getDistance2D(point, shorterPt);
            }
        });

        return answer;
    }
};

exports.LineTools = LineTools;

function Trimmer(/* List<LatLongLine> */gridLines, /* Polygon */polygon) {
    this.trimmedGrid = [];

    this.findCrossings = function(polygon, gridLine) {
        const crossings = []; // <LatLong>

        // For each side of the polygon, find intersections between gridLine and the
        // line representing the polygon side.
        polygon.map((polyLine) => {
            const intersection = LineTools.findLineIntersection(polyLine, gridLine);
            if(intersection) {
                crossings.push(intersection);
            }
        });

        return crossings;
    }

    this.processCrossings = function(crosses, gridLine) {
        switch(crosses.length) {
            case 0:
            case 1:
                break;
            case 2: {
                this.trimmedGrid.push(new LineLatLong(crosses[0], crosses[1]));
                break;
            }
            default: { // TODO: Handle multiple crossings in a better way
                this.trimmedGrid.push(LineTools.findExternalPoints(crosses));
            }
        }
    }

    this.getTrimmedGrid = /* List<LineLatLong> */ function() { return this.trimmedGrid; }

    gridLines.map((gridLine) => {
        const crosses = this.findCrossings(polygon, gridLine);
        this.processCrossings(crosses);
    });
}

exports.Trimmer = Trimmer;

const MAX_NUMBER_OF_CAMERAS = 10000;

function EndpointSorter(trimmedGrid, sampleDistance) {
    this.gridPoints = []; // <LatLong>
    this.grid = []; // <LineLatLong>
    this.sampleDistance = 0;
    this.cameraLocations = []; // <LatLong>

    this.grid = trimmedGrid;
    this.sampleDistance = sampleDistance;

    this.sortGrid = function(lastpnt, sort) {
        while(this.grid.length > 0) {
            if(sort) {
                const closestLine = LineTools.findClosestLineToPoint(lastpnt, this.grid);
                const secondWp = this.processOneGridLine(closestLine, lastpnt, sort);
                lastpnt = secondWp;
            } else {
                const closestLine = this.grid[0];
                const secondWp = this.processOneGridLine(closestLine, lastpnt, sort);
                lastpnt = secondWp;
            }
        }
    }

    this.processOneGridLine = function(closestLine, lastpnt, sort) {
        let firstWP = closestLine.getClosestEndpointTo(lastpnt);
        let secondWP = closestLine.getFarthestEndpointTo(lastpnt);

        this.grid.splice(this.grid.indexOf(closestLine), 1);

        this.updateCameraLocations(firstWP, secondWP);
        this.gridPoints.push(firstWP);
        this.gridPoints.push(secondWP);
        return secondWP;
    }

    this.updateCameraLocations = function(firstWP, secondWP) {
        const cams = new LineSampler(firstWP, secondWP).sample(this.sampleDistance);
        cams.map(cam => this.cameraLocations.push(cam));
    }

    this.getSortedGrid = function() { return this.gridPoints; }
    this.getCameraLocations = function() { return this.cameraLocations; }
}

exports.EndpointSorter = EndpointSorter;

function LineSampler(first, second) {
    this.points = [first, second];
    this.sampledPoints = [];

    this.sample = /* List<LatLong> */function(sampleDistance) {
        this.sampledPoints = [];
        const points = this.points;

        for(let i = 1; i < points.length; ++i) {
            const from = points[i - 1];
            if(!from) continue;
            const to = points[i];

            const samples = this.sampleLine(from, to, sampleDistance);
            samples.map(s => this.sampledPoints.push(s));
        }

        const lastPoint = points[points.length - 1];
        if(lastPoint) {
            this.sampledPoints.push(lastPoint);
        }

        return this.sampledPoints;
    }

    this.sampleLine = function(from, to, sampleDistance) {
        const result = [];

        const heading = MathUtils.getHeadingFromCoordinates(from, to);
        const totalLength = MathUtils.getDistance2D(from, to);
        let distance = 0;

        while(distance < totalLength) {
            result.push(MathUtils.newCoordFromBearingAndDistance(from, heading, distance));
            distance += sampleDistance;
        }

        return result;
    }
}

exports.LineSampler = LineSampler;

function doTests() {
    const width = 40;
    const length = 80;

    const topLeft = { "lat": 38.649028, "lng": -94.344903, "alt": 0 };
    const topRight = MathUtils.newCoordFromBearingAndDistance(topLeft, 90, width);
    const bottomRight = MathUtils.newCoordFromBearingAndDistance(topRight, 180, length);
    const bottomLeft = MathUtils.newCoordFromBearingAndDistance(topLeft, 180, length);

    const corners = [topLeft, topRight, bottomRight, bottomLeft];

    const poly = new Polygon().addPoints(corners);

    const params = {
        angle: 20,
        wpDistance: 4,
        lineDistance: 2     
    };

    const gridBuilder = new GridBuilder(poly, params);
    const grid = gridBuilder.generateGrid(true);

    console.log(`grid=${JSON.stringify(grid)}`);
}


if(process.mainModule === module) {
    doTests();
}
