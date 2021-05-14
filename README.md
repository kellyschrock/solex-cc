# Solex CC

Solex CC is a high-level scripting interface for companion computers on Mavlink vehicles (planes, copters, rovers, etc). 

To be more accurate about it, it's a dispatcher that forwards Mavlink and GCS messages between a vehicle and _workers_ that send or handle those messages.

The idea is that you write workers as NodeJS modules, and they're loaded into memory and execute according to their settings. You can:

*   Listen to and respond to Mavlink messages
*   Respond to messages direct from a GCS (if it's sending messages to solex-cc workers)
*   Send Mavlink messages to the vehicle
*   Receive commands from a GCS to do various things with attached devices
*   Send messages to a GCS through a WebSockets interface

Solex CC handles the loading and configuration of workers, along with a consistent interface to implement for creating your own workers.

## What's it for?

Anything where you want to conveniently add functionality to a vehicle. For example, there are workers for controlling an onboard camera, providing access 
to a GCS to pictures taken by the camera, controlling on-board LEDs, "Smart Shots" (made popular by the 3DR Solo), and workers that allow multiple vehicles
to communicate with each other and coordinate their activities (see *IVC* below).

Essentially, anything a small on-board computer (e.g. Raspberry Pi, Jetson Nano, etc) can do with either the flight controller directly, or any other on-board device,
SolexCC workers can do.

## Why Node JS?

The point here is convenience. You can create and upload workers and install and remove them dynamically, and part of the whole "convenience" thing is to use a language
that's easy and approachable. Also, `npm`. There is a _ton_ of functionality available already in the form of plugins via `npm`.

## Dispatcher

The main driver of things is the **dispatcher**, which starts when the main process starts. It exposes a few endpoints for control:

*   `/dispatch/start` -- Start the dispatcher (which happens automatically anyway)
*   `/dispatch/stop`  -- In case you want to stop it
*   `/dispatch/reload` -- In case you want to reload workers while the dispatcher is already running. (Note that you have to call `/dispatch/start` after reloading.)

### Dispatcher configuration

The `config.json` file at the root of the app directory is where things are configured. The `dispatcher` section of the configuration
looks like this:

```json
    "dispatcher": {
        "worker_roots": [
            "/home/solex-cc/workers",
            "/home/solex-cc/some-other-dir"
        ],
        "worker_lib_root": "worker_lib",
        "sysid": 221,
        "compid": 101,
        "loop_time_ms": 1000,
    },
    "udp": {
        "port": 14557
    },
    "ivc": {
        "client_ping_time": 3000,
        "broadcast_interval": 5000,
        "client_timeout": 10000,
        "disabled": false
    }
```

*   `worker_roots` is an array of paths where workers can be found.
*   `worker_lib_root` is a path under SolexCC's `app` directory where optional worker libraries can be found.
*   `sysid` and `compid` are the sysid/compid that will be used on Mavlink messages going to the vehicle (where applicable). This _must_ match the sysid of the vehicle.
*   `loop_time_ms` is how long the interval is between runs of the `loop()` function in the dispatcher. Any workers reporting that they wish to loop will have their `loop()` functions executed at this time.
*   `udp_port` specifies the port the dispatcher listens on for incoming Mavlink messages. On an `apsync` implementation, `cmavnode` is used to forward Mavlink messages from `/dev/ttyS0` to UDP. So the dispatcher can use the normal value of `14550` here to listen to the UDP broadcasts that go out, or use an alternate port and configure `cmavnode` to send UDP packets to it directly.
*   `ivc` refers to IVC configuration, and is optional. If `disabled` is set to `true`, IVC will not run. (See "IVC" below.)


You can see the current configuration at runtime by hitting the `/config` endpoint once Solex CC is up and running.

## Workers

_Workers_ are scripts you write and install on a SolexCC instance to define features a given vehicle has. 

To get a list of workers currently loaded on the system, call the `/workers` endpoint, which returns a list of the loaded workers.

```json
[
    {
        "id": "another_test",
        "name": "Another test",
        "description": "Messes with stuff",
        "looper": false,
        "mavlinkMessages": [ "ATTITUDE" ],
        "sysid": 221,
        "compid": 101,
        "path": "/whatever/dir/the/worker/is/in"
    },
    {
        "id": "test_worker",
        "name": "Test worker",
        "description": "Does not do much",
        "looper": true,
        "mavlinkMessages": [ "HEARTBEAT", "GLOBAL_POSITION_INT" ],
        "sysid": 221,
        "compid": 101,
        "path": "/whatever/dir/the/worker/is/in"
    }
]
```

### Getting Worker Messages

To get messages from a worker, a GCS establishes a WebSockets connection with the companion computer while Solex CC is running. WebSockets are used since they're usable from anything from Android/iOS/desktop apps to web apps. 

A GCS sends a message like this over the WebSockets connection:

```json
{
    "type": "subscribe-gcs"
}
```

Once subscribed, a message arriving at the GCS from a worker looks like this:

```json
{
    "event": "worker-to-gcs",
    "data": {
        "worker_id": "worker-id-who-sent-the-message",
        "message": {
            // Message body
        }
    }
}
```

### Unsubscribing from GCS Messages

To stop listening for GCS messages, either break the WebSockets connection (duh!) or send a message like this over the connection:

```json
{
    "type": "unsubscribe-gcs"
}
```

### Sending a GCS message to a worker

You can do this 2 ways.

#### WebSocket

Send a message like this:

```json
{
    "type": "gcs-to-worker",
    "worker_id": "worker-id-getting-message",
    "msg": {
        "whatever_fields_you_want": "Content of the message"
    }
}
```

The `msg` portion of the message will be sent to the worker.

### Endpoint

You can also send the same message via `POST /worker/msg/:worker_id`, where `worker_id` is the ID of the worker the message is for. The body of the POST is the same as the `msg` portion of the WebSocket message above. This is preferable to the web-sockets approach most of the time.

### Worker configuration

A worker specifies how it wants to work by exposing a set of attributes to the dispatcher. Here's an example:

```javascript
const ATTRS = {
    id: "my_worker",
    name: "My worker",
    description: "Something about what this worker is for",
    // If true, this workers loop() function will be called each time the dispatcher loops.
    looper: true,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GLOBAL_POSITION_INT"]
};

exports.getAttributes = function() { return ATTRS; }
```

(The `id` field doesn't need to be a UUID, but does need to be unique within the overall collection of workers.)

It's necessary to define the attributes this way (as opposed to just returning a JSON object from getAttributes()), because the dispatcher actually modifies them with a few things. Namely, its sysid/compid (so a worker knows what sysid/compid to use when sending Mavlink messages), and the addition of `sendMavlinkMessage()` and `sendGCSMessage()` functions.

A worker can also get a list of other workers on the system by calling `ATTRS.getWorkerRoster()`.

### Worker startup

If your worker needs to initialize when it's loaded, implement `onLoad()`:

```javascript
exports.onLoad = function() {
    console.log(ATTRS.name + " loaded");
};
```

### Worker shutdown

Similarly, you can respond to being unloaded:

```javascript
exports.onUnload = function() {

};
```

### Looping

If you want your worker to act like an Arduino or something, implement `loop()` in it and set the `loop_time_ms` value to something fairly reasonable (100ms for example). The loop function is pretty simple:

```javascript
exports.loop = function() {

};
```

### Responding to Mavlink messages

If your worker needs to take some action in response to a Mavlink message coming from the vehicle, include the name of the Mavlink message in the `mavlinkMessages` array property of your attributes object. When that message arrives in the dispatcher, your worker's `onMavlinkMessage()` function will be called with that message. Here's an example implementation:

```javascript
exports.onMavlinkMessage = function(msg) {
    switch(msg.name) {
        case "HEARTBEAT": {
            // Got a heartbeat message
            break;
        }

        case "GLOBAL_POSITION_INT": {
            if(msg.relative_alt >= (20 * 1000)) {
                // Vehicle is at least 20m above the launch point
            }

            break;
        }
    }
}
```

### Responding to GCS messages

To respond to a GCS message (described above), just implement `onGCSMessage()` like this:

```javascript
exports.onGCSMessage = function(msg) {
    const result = {
        ok: true
    };

    // Passed-in message will be a Javascript object with a structure matching the JSON that was passed from the GCS.
    switch(msg.id) {
        case "my-worker-message": {
            // Properties on msg are specified by the GCS in the POST body or WS message coming to this worker.
            break;
        }

        case "some-other-message": {
            break;
        }

        default: {
            result.ok = false;
            break;
        }
    }

    return result;
};
```

## Worker Libraries

Workers are intended to be stand-alone packaged things that can be deployed independently. Thus they often have their own libraries installed
via `npm install`. However, if you have a bunch of workers that all make use of the same things, it's nice to be able to have those common features in libraries. 
An example is `mavlink.js`. That really should be shared between SolexCC and any workers dealing with it, so the message definitions are the same.

### Example worker libraries

The default installation includes a "worker_lib" directory under `app` that contains utility modules used by workers. They are:

-   `MathUtils.js` A port of MathUtils.java from DroneKit-Android. Useful for dealing with locations.
-   `MavlinkCommands.js` A bunch of utility functions intended to make dealing with common Mavlink messages easier.
-   `Vehicle.js` More short-hand/convenience functions for dealing with vehicle events, etc
-   `VehicleState.js` More convenience functions for vehicles.
-   `WorkerUI.js` Functions for dealing with various worker-UI aspects of Solex.

The examples in an associated project illustrate these libraries in use.

To add a library, put it in the directory specified at "dispatcher.worker_lib_root" in `config.json`. At load time, the dispatcher
will load all of the files found in that directory, and assign an `api` property to the `ATTRS` object for a worker, with the module name
as an attribute of `api`. So if you have (for example) a `MySpecialAPI.js` file and put it there, you worker will be able to access the functions in it via:

```javascript
ATTRS.api.MySpecialAPI.someFunction()
```

The same module will be shared across all workers. Do _not_ expect to put a `worker.js` file in this directory and have it work. You'll just end up with
`ATTRS.api.worker`, which would be fairly useless.

### Sending Mavlink messages

Sending a Mavlink message is fairly straightforward. Use the functions in `mavlink` to actually _create_ the messages, like this:

```javascript
const msg = new mavlink.messages.command_long(
    ATTRS.sysid, // sysid
    ATTRS.compid, // compid
    mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
    0, // confirmation
    arm,
    0, // emergencyDisarm
    0, 0, 0, 0
);

ATTRS.sendMavlinkMessage(ATTRS.id, msg);
```

In the example above, `ATTRS.sysid` and `ATTRS.compid` are set to the sysid/compid of the dispatcher. You don't have to do this in the worker, the dispatcher does it. 

The message is made by the `mavlink` object used by the dispatcher. Then the message is sent via `sendMavlinkMessage()`, a function that is attached to each worker when the dispatcher loads it. Note that the first parameter is the worker ID, not the message. This is to allow the dispatcher to know which worker is sending which message.

### Sending GCS messages

As mentioned above, GCS messages are not defined according to a specific standard. They can be whatever format the GCS and a worker agree they should be. So here is an example of a worker sending a GCS message every 5 seconds or so:

```javascript
var lastSendTime = Date.now();

function loop() {
    const now = Date.now();

    if((now - lastSendTime) >= 5000) {
        const msg = {
            id: "some-madeup-message-id",
            text: "Hello, a message from worker " + ATTRS.name,
            current_time: now
        };

        ATTRS.sendGCSMessage(ATTRS.id, msg);
        lastSendTime = now;
    }
}

exports.loop = loop;
```

### Listening for roster changes

The "roster" is the list of installed workers. A worker can listen for changes to the roster (workers being installed or removed)
and respond to them by exporting an `onRosterChanged()` function, like this:

```javascript
exports.onRosterChanged = function() {
    // Roster has changed
}
```

## Building a Worker

A worker is just like any Node app, except it's loaded on the fly by the dispatcher. So if you need specific Node JS modules in your worker, just load them via `require` like you would anywhere else. Here are the basic steps to starting a worker project:

1.  Create a directory for your worker project, and `cd` to that directory.
2.  Run `npm init` in that directory.
3.  Run `npm install --save (whatever modules you need)` for each module you require (`serialport`, `jspack`, etc).
4.  Load up the project in whatever IDE you prefer to use.
5.  Implement the worker methods as shown above.

### Testing a Worker

To fully test a worker implementation, it needs to have access to incoming Mavlink messages and be connected to a GCS. There is no super-quick and simple way to do this, but it's not difficult.

One reliable way to do it is to run the `solex-cc` web app on your development machine by `cd`ing to the `app` directory of this project and running it via `node app.js`. Everything starts up normally, and the worker directories listed under `worker_roots` in the configuration are loaded and run. At that point, the app is also listening for UDP broadcasts from apsync or some other UDP broadcaster for Mavlink messages. You can use that to receive UDP messages from a vehicle connected on UDP, or SITL. Your worker can register for the messages it's interested in seeing, and they'll appear in its `onMavlinkMessage(msg)` function. 

For sending GCS messages, you can just send them from your worker, and it's up to a connected GCS to register for and listen to them. You have to write all that yourself. The essential point of this project is that you _can_ write a GCS that receives messages from a worker, so that's not really an issue.

## Installation

Solex CC is a Node JS app, so you need Node JS installed on your companion computer. Then you need to ensure it gets launched when the 
companion computer boots. Here is an example of setting things up on a Raspberry Pi to launch Solex CC at boot time.

### Install NodeJS

Use the package manager to install the latest version of Node JS:

```
$ sudo apt-get install nodejs
```

### Install `cmavnode`

If you're running an `apsync` installation, cmavnode is probably already installed and you can skip this step. If not (`apsync` is not required),
you can install `cmavnode` by copying the contents of `deploy/cmavnode` to the Pi so that you end up with `$HOME/cmavnode` on the target device. Once there, 
locate and edit `$HOME/cmavnode/cmavnode.service` and ensure the paths specified in it are correct. Then run these commands:

```
$ sudo ln -s $HOME/cmavnode/cmavnode.service /etc/systemd/system/cmavnode.service
$ sudo systemctl start cmavnode
```

If no errors appear, cmavnode is working. Make it start at boot time by running `sudo systemctl enable cmavnode`.

### Install SolexCC

Start with the `deploy` directory. Copy that to the appropriate `$HOME` directory on the Pi so you end up with `$HOME/solexcc`. Edit the `start_solex.cc` and `autostart_solexcc.sh` files so they point to the appropriate `node` executable and directories. 

Test the installation by `cd`ing to `$HOME/solexcc` and running `./start_solexcc.sh`. If you see output showing a successful startup, then it works.

### Make it start on boot

There are two ways to do this. 

#### `rc.local`
Edit `/etc/rc.local` and add this line at the bottom of the file:

`/bin/bash -c '~apsync/solexcc/autostart_solexcc.sh'`

#### Systemd

You can install SolexCC as a systemd service, which is easier to manage than the `rc.local` approach in some cases.

Find and edit `$HOME/solexcc/solexcc.service` and make sure the paths it references are correct. Then run the following commands:

```
$ sudo ln -s $HOME/solexcc/solexcc.service /etc/systemd/system/solexcc.service
$ sudo systemctl start solexcc
```

If no errors appear, then SolexCC can be started as a service. Stop the service with `sudo systemctl stop solexcc`.

To make SolexCC start at boot tme, run `sudo systemctl enable solexcc`.

Note that the output of both `solexcc` and `cmavnode` as systemd services will appear in `/var/log/syslog`.

### Make worker root(s)

You'll need a place to put workers, so create a worker directory at `/home/pi/cc-workers`. (You can add more of these, depending on how you prefer to organize things.) Each worker will appear in its own directory under this one.

Edit the `$APP_HOME/config.json` file to include your worker directory.

## UI

SolexCC has a basic UI for messing with workers (listing and testing them). Open your browser to the base address SolexCC is running on.
The main page shows a list of currently installed. You can install new ones from a panel below that list, and remove workers by clicking
on the red "Remove" button next to a worker in the list.

You can also do basic testing of worker message handling from the "Test a worker" page.

## Worker Logging

Since it's kind of hard to run your worker in a debugger while it's installed on the vehicle, it's helpful to log output to the console
so you can see what's going on. To do this, don't use `console.log()`. It will work, but it will just spew output to the console, which is probably being captured in a file on the CC's filesystem, which you'd have to SSH into the CC in order to see. It's not as cool as `ATTRS.log(ATTRS.id, msg)`.

If you use that, then the dispatcher logs it to the console. You can also filter which output is actually sent by calling this:

`GET /dispatch/log_filter/:worker_ids`

Where `:worker_ids` is a comma-delimited list of the worker ids you want to see output for.

You can also specify these filters in the "Logging" page on the UI in case you want to view log output there.

## IVC

Stands for "Inter-Vehicle Communication", a lofty-sounding term describing the ability of vehicles on a given network to discover and communicate with each other, coordinating 
their activities.

### How it works
At startup, SolexCC loads all of its installed workers. Once they're all loaded (thus providing a set of "features" for a SolexCC instance), IVC starts and sends a periodic UDP broadcast to advertise its presence on the network.

Another SolexCC instance gets this broadcast, and starts a direct connection between itself and the broadcaster. It notifies all installed workers that a "peer" has appeared on the network. If any worker is interested in specific functions a peer might provide, it interrogates the new peer to find out what functionality it offers. If interested, the worker
can subscribe to topics provided by the new peer, which essentially gives a vehicle the ability to monitor the state of other vehicles. The two vehicles can then coordinate their
work.

For example, the `mission_split` worker can be installed on 2 or more copters. The same mission can then be uploaded to both or all of them. Then the vehicles can be armed and launched to a hover, one by one. As each vehicle launches, it will communicate with the other vehicles that have already launched and have the same mission loaded. It will split the overall mission into segments and coordinate with the other vehicles to split the overall mission up. Each vehicle will fly a portion of the mission based on how many vehicles are going to fly it at the same time (e.g. half each for 2 copters, 1/3 each for 3 copters, etc). 

The `follow_other` worker monitors a target vehicle's location and can be instructed by the GCS to fly in formation with it, to follow the same path as the target vehicle, to orbit the target vehicle, etc.

A worker could be created to basically ensure a minimum distance between vehicles as they fly. Up to you... Just whatever you want to do.

