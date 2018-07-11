# Solex CC

Solex CC is a high-level scripting interface for companion computers on Mavlink vehicles (planes, copters, rovers, etc). 

To be more accurate about it, it's a dispatcher that forwards Mavlink and GCS messages between a vehicle and _workers_ that send or handle those messages.

The idea is that you write workers as NodeJS modules, and they're loaded into memory and execute according to their settings. You can:

*   Listen to and respond to Mavlink messages
*   Respond to messages direct from a GCS (if it's sending messages to solex-cc workers)
*   Send Mavlink messages to the vehicle
*   Send messages to a GCS through a WebSockets interface.

Solex CC handles the loading and configuration of workers, along with a consistent interface to implement for creating your own workers.

## What's it for?

Suppose you have a camera connected to a USB port the companion computer that you want to control via Mavlink messages like `DO_DIGICAM_CONFIGURE` and `DO_DIGICAM_CONTROL`, and report camera status. You can write a worker that communicates with the camera through the USB port, and subscribes to the above Mavlink messages. When a `DO_DIGICAM_CONTROL` message arrives, you can do whatever's needed on the USB port to tell the camera to take a picture, start video recording, etc. You can also make it send `CAMERA_STATUS` and `CAMERA_FEEDBACK` messages as appropriate to report status.

Or suppose you have some kind of sensor on the vehicle that isn't something ArduPilot typically knows about, but a typical Linux machine _does_ know how to make use of. Suppose also that you want to start reading and logging data from this sensor as soon as a running mission reaches the first waypoint in a survey area, and stop logging after the _last_ waypoint. To do this, you could write whatever scripts and programs you need in order to interact with the sensor and call them from a worker. Or (even better), you could implement all of that as a worker. Install it on the companion computer on the vehicle, load it, and run your mission.

Suppose you want to control the vehicle directly in a specific way in response to a command sent from a GCS (similar to the way Smart Shots work on a 3DR Solo), and report status back to the GCS.

Suppose you've developed a vehicle that has pluggable payloads (cameras, sensors, etc) controlled by their own onboard computers. 
You can define a common interface via workers on Solex CC and have it expose that interface to a GCS, handling the differences
between the various payloads onboard the vehicle (or the case of there being no installed payload at all).

These are the sorts of things of thing workers, and this interface in general, are intended to address. 

## Dispatcher

The main driver of things is the **dispatcher**, which starts when the main process starts. It exposes a few endpoints for control:

*   `/dispatch/start` -- Start the dispatcher (which happens automatically anyway)
*   `/dispatch/stop`  -- In case you want to stop it
*   `/dispatch/reload` -- In case you want to reload workers while the dispatcher is already running

### Dispatcher configuration

The `config.json` file at the root of the app directory is where things are configured. The `dispatcher` section of the configuration
looks like this:

```json
    "dispatcher": {
        "worker_roots": [
            "/home/solex-cc/workers",
            "/home/solex-cc/some-other-dir"
        ],
        "sysid": 221,
        "compid": 101,
        "loop_time_ms": 1000,
        "udp_port": 14550
    }
```

*   `worker_roots` is an array of paths where workers can be found.
*   `sysid` and `compid` are the sysid/compid that will be used on Mavlink messages going to the vehicle.
*   `loop_time_ms` is how long the interval is between runs of the `loop()` function in the dispatcher. Any workers reporting that they wish to loop will have their `loop()` functions executed at this time.
*   `udp_port` specifies the port the dispatcher listens on for incoming Mavlink messages. On an `apsync` implementation, `cmavnode` is used to forward Mavlink messages from `/dev/ttyS0` to UDP. So the dispatcher can use the normal value of `14550` here to listen to the UDP broadcasts that go out, or use an alternate port and configure `cmavnode` to send UDP packets to it directly.

You can see the current configuration at runtime by hitting the `/config` endpoint once Solex CC is up and running.

### Dispatcher Messages

The main job of the dispatcher is to pass Mavlink and GCS messages back and forth between their source and workers. 

#### Mavlink Messages

The dispatcher listens on the specified UDP port for incoming Mavlink messages. Each time one is received, it passes that message to any workers that have registered to receive it, and passes it to them via their `onMavlinkMessage()` function if it exists.

#### GCS Messages

The point of this feature is to allow the passing of messages between the GCS and a worker, and have those messages not have to be Mavlink messages, or for them to flow through the Mavlink connection. Solex CC exposes a set of endpoints for sending messages and a WebSockets interface for a client to receive messages. The term "GCS message" is a generic concept referring to whatever is being passed back and forth. It's typically something like a JSON object.

## Workers

Workers, unsurprisingly, are where the work gets done in Solex CC. They're the scripts you write yourself to do whatever thing you're interested in doing on the companion computer. They're loaded into memory by the **dispatcher**, which interacts with them in various ways.

### Retrieving a list of workers

To get a list of workers currently loaded on the system, call the `/workers` endpoint, which will return all of their attributes:

```json
[
    {
        id: "1130a982-d72e-420b-89f0-071a57509aeb",
        name: "Another test",
        description: "Messes with stuff",
        looper: false,
        mavlinkMessages: [ "ATTITUDE" ],
        sysid: 221,
        compid: 101,
        path: "/whatever/dir/the/worker/is/in"
    },
    {
        id: "55c93de2-9e24-4937-b0d5-36ecf8ea6b90",
        name: "Test worker",
        description: "Does not do much",
        looper: true,
        mavlinkMessages: [ "HEARTBEAT", "GLOBAL_POSITION_INT" ],
        sysid: 221,
        compid: 101,
        path: "/whatever/dir/the/worker/is/in"
    }
]
```

### Getting Worker Messages

To get messages from a worker, a GCS establishes a WebSockets connection with the companion computer while Solex CC is running. WebSockets are used since they're usable from anything from Android/iOS/desktop apps to web apps. 

A GCS sends a message like this over the WebSockets connection:

```json
{
    type: "subscribe-gcs"
}
```

Once subscribed, a message arriving at the GCS from a worker looks like this:

```json
{
    event: "worker-to-gcs",
    data: {
        worker_id: "worker-id-who-sent-the-message",
        message: {
            // Message body
        }
    }
}
```

### Unsubscribing from GCS Messages

To stop listening for GCS messages, either break the WebSockets connection (duh!) or send a message like this over the connection:

```json
{
    type: "unsubscribe-gcs"
}
```

### Sending a GCS message to a worker

You can do this 2 ways.

#### WebSocket

Send a message like this:

```json
{
    type: "gcs-to-worker",
    worker_id: "worker-id-getting-message",
    msg: {
        whatever_fields_you_want: "Content of the message"
    }
}
```

The `msg` portion of the message will be sent to the worker.

### Endpoint

You can also send the same message via `POST /worker/msg/:worker_id`, where `worker_id` is the ID of the worker the message is for. The body of the POST is the same as the `msg` portion of the WebSocket message above.

### Worker configuration

A worker specifies how it wants to work by exposing a set of attributes to the dispatcher. Here's an example:

```javascript
const ATTRS = {
    // Unique UUID (just use an online generator to get one of these)
    id: "55c93de2-9e24-4937-b0d5-36ecf8ea6b90",
    name: "My worker",
    description: "Something about what this worker is for",
    // If true, this workers loop() function will be called each time the dispatcher loops.
    looper: true,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GLOBAL_POSITION_INT"]
};

exports.getAttributes = function() { return ATTRS; }
```

It's necessary to define the attributes this way, because the dispatcher actually modifies them with a few things. Namely,
its sysid/compid (so a worker knows what sysid/compid to use when sending Mavlink messages), and the addition of `sendMavlinkMessage()`
and `sendGCSMessage()` functions.

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
    // Passed-in message will be a Javascript object with a structure matching the JSON that was passed from the GCS.
};
```

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

## Building a Worker

A worker is just like any node app, except it's loaded on the fly by the dispatcher. So if you need specific Node JS modules in your worker, just load them via `require` like you would anywhere else. Here are the basic steps to starting a worker project:

1.  Create a directory for your worker project, and `cd` to that directory.
2.  Run `npm init` in that directory.
3.  Run `npm install --save (whatever modules you need)` for each module you require (`serialport`, `jspack`, etc).
4.  Load up the project in whatever IDE you prefer to use.
5.  Implement the worker methods as shown above.
6.  ???
7.  Profit!

### Testing a Worker

To fully test a worker implementation, it needs to have access to incoming Mavlink messages and be connected to a GCS. There is no super-quick and simple way to do this, but it's not _too_ difficult.

One reliable way to do it is to run the `solex-cc` web app on your development machine by `cd`ing to the `app` directory of this project and running it via `node app.js`. Everything starts up normally, and the worker directories listed under `worker_roots` in the configuration are loaded and run. At that point, the app is also listening for UDP broadcasts from apsync or some other UDP broadcaster for Mavlink messages. You can use that to receive UDP messages from a vehicle connected on UDP, or SITL. Your worker can register for the messages it's interested in seeing, and they'll appear in its `onMavlinkMessage(msg)` function. 

For sending GCS messages, you can just send them from your worker, and it's up to a connected GCS to register for and listen to them. You have to write all that yourself. The essential point of this project is that you _can_ write a GCS that receives messages from a worker, so that's not really an issue. :smile:

## Installation

Solex CC is a Node JS app, so you need Node JS installed on your companion computer. Then you need to ensure it gets launched when the 
companion computer boots. Here is an example of setting things up on a Raspberry Pi running `apsync` to launch Solex CC at boot time.

### Install NodeJS

Use the package manager to install the latest version of Node JS, or install a copy of NodeJS in the `/home/apsync/start_solexcc` directory. The included `*start_solexcc.sh` scripts assume you've done the latter, but it's not required.

### Install the app

This is mainly a matter of copying the relevant files to the right directories. 

The best thing to do is to start with the `deploy` directory. Copy that to the `/home/apsync` directory on the Pi so you end up with `/home/apsync/start_solexcc`. Edit the `start_solex.cc` and `autostart_solexcc.sh` files so they point to the appropriate `node` executable and directories. In the example scripts, Node is installed under `/home/apsync/start_solexcc` and symlinked to `node`.

Test the installation by `cd`ing to `/home/apsync/start_solexcc` and running `./start_solexcc.sh`. If you see output showing a successful startup, then it works.

### Make it start on boot

Edit `/etc/rc.local` and add this line at the bottom of the file:

`/bin/bash -c '~apsync/start_solexcc/autostart_solexcc.sh'`

### Solex CC and apweb

APSync already has a web server that runs on port 80. If you don't need that, you can comment out the line that starts it in `/etc/rc.local` and set the `PORT` directive in `start_solexcc.sh` to 80. Otherwise, you can pick a different port for Solex CC (e.g. 8080), and run both web servers at the same time.


### Make worker root(s)

You'll need a place to put workers, so create a worker directory at `/home/apsync/cc-workers`. (You can add more of these, depending on how you prefer to organize things.) Each worker will appear in its own directory under this one.

Edit the `$APP_HOME/config.json` file to include your worker directory.

