
const child_process = require('child_process');
const Log = require("../util/logger");

var listeners = {};

function log(str) {
    Log.v("commands", str);
}

// POST exec a command
/*
Request body:
{
    command: "/path/to/script param1 param2 param3 etc"
}

Response body:
{
    command: input command,
    exit_code: returned from child process,
    stdout: output on stdout,
    stderr: output on stderr
    success: true/false (did it work?)
}
*/
exports.execCommand = function(req, res) {
    var input = req.body.command;

    var output = {
        command: input,
        exit_code: 0,
        stdout: "",
        stderr: "",
        success: false
    };


    if(input !== '') {
        child_process.exec(input, function(err, stdout, stderr) {
            if(err) {
                log(JSON.stringify(err));
                output.success = false;
                output.exit_code = err.code;
            } else {
                output.exit_code = 0;
                output.stdout = stdout;
                output.stderr = stderr;
                output.success = true;
            }

            res.json(output);
        });
    } else {
        res.json(output);
    }
};

exports.startDaemon = function(param, listener) {

    var args = param.command.split(" ");

    var child;

    if(args.length > 1) {
        child = child_process.spawn(args[0], args.slice(1));
    } else {
        child = child_process.spawn(args[0]);
    }

    listeners[param.id] = { process: child };

    child.on('error', function(err) {
        log("got an error running command: " + err);
        delete listener[param.id];

        if(listener.onError) {
            listener.onError(err);
        }
    });

    child.stdout.on('data', function(chunk) {
        listener.onData(chunk.toString('utf8'));
    });

    child.on('close', function() {
        log("process closed");
        delete listener[param.id];

        if(listener.onClose) {
            listener.onClose();
        }
    });
};

exports.stopDaemon = function(param, cb) {
    var child = listeners[param.id];
    if(child) {
        child.process.kill('SIGHUP');
        delete listeners[param.id];

        if(cb && cb.onClose) {
            cb.onClose();
        }
    }
};

