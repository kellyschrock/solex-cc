# Features

Features are a way to let Solex know about specific things the CC in a given vehicle supports. As you might expect, the features are implemented by workers.

## Video Support

Most vehicles have some kind of camera on them, but some don't. So the default for Solex is to assume a vehicle _doesn't_ feature video support.

To control that, it supports a feature called `video_support`. If a worker indicates that video support exists on the vehicle, it displays the video portion of the flight screen when opened, and assumes that the vehicle actually _does_ support video and will start streaming when the screen opens.

The `features/video` worker indicates video support like this:

```javascript
function getFeatures() {
    d("getFeatures()");
    
    // Return a single feature, or multiple
    return {
        video: { 
            supported: true,
            ports: [5600]
        }
    };
}

exports.getFeatures = getFeatures;
```

## Mission Support

In addition to providing a UI for controlling them, workers can also specify an interface to allow control over them from missions. This is handy if you want to automate their operation while the vehicle is flying around on its own. The `features/missions` worker indicates the presence of mission support, and reports mission-item support handled by all workers in the system. 

The `features/missions` worker does this by interrogating all workers on the system and checking if they support the `getMissionItemSupport` interface. If they do, it asks them to provide their support for mission-item actions. The `fake-sensor` example worker implements that function like this:

```javascript
function getMissionItemSupport(workerId) {
    return {
        id: ATTRS.id,
        name: ATTRS.name,
        actions: [
            { 
                id: "start", 
                name: "Start", 
                msg_id: "start", 
                params: [
                    { 
                        id: "sample_rate", 
                        name: "Sample rate", 
                        type: "int", 
                        min: 10, max: 100, default: 20
                    },
                    { id: "depth", name: "Sensor depth", type: "decimal", default: 16.9 }
                ]
            },
            { id: "stop", name: "Stop", msg_id: "stop" }
        ]
    }
}
```

This says, essentially, that there are 2 actions, `start` and `stop`, supported by the `fake-sensor` worker. The `start` action takes a set of parameters controlling how to start it: `sample_rate` (an integer value), and `depth`, a decimal number.

(**Note:** Full documentation on the various param types is in the `features/README.md` file in the examples.)

With all of this in place, create a small mission in Solex and drop a waypoint in it. Click on the waypoint to expose its details. In the "Actions" list, select "Add", and you'll see a "Fake Sensor: Start" action. Click on that, and then click on the "Fake Sensor: Start" action once it's added to the waypoint. A dialog will display showing fields allowing you to specify parameters for the `start` action when it occurs in a mission. 

Another thing the `features/missions` worker specifies in `mission` support is the worker ID of the mission support worker, and a message to send when it's time to upload the mission to the vehicle. The `features/mission` worker accepts an upload from Solex of all the mission-item actions in the mission, along with their position in the mission. 

As the mission runs, the `features/missions` worker will monitor progress through the mission and execute these actions on-board at the appropriate times. 

So now your workers' actions are automated.

_Anyway_, that's what features are for. It's a way for your vehicle to tell Solex what known features it actually supports.
