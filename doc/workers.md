# All about Workers

Workers are at the core of what SolexCC does. They're loaded dynamically into SolexCC's process and can interact with the vehicle, attached hardware _on_ the vehicle, and with each other. Following is a list of some of the interfaces supported by workers, and what you can do with them.

## Worker basics

Workers are _always_ in a file called `worker.js`. To build a worker, you start out by creating a directory for your worker project, and creating (or copying) a `worker.js` file into it. Other scripts can go into your worker project as well, but the entry point for a worker is always `worker.js`. Not `Worker.JS` or `wOrKeR.jS`. **`worker.js`**. 

## `npm`

You may have been reading all of this and the whole time, you're wondering: "Why did this get created in NodeJS and not Python or C or Java?" If so, you've probably not heard of `npm`. Npm is a _YUGE_ collection of libraries for doing all manner of things in Node apps. You can use them just as easily here as you can in any Node app. If you have dependencies on `npm` libraries in your workers, then just specify them in a `package.json` file the way they get specified in a normal Node app. When you install a worker, SolexCC will attempt to run `npm install` on your worker to set it up. You obviously need to ensure your vehicle has an internet connection in that case, but that's easy. See <a href="setup.md">Setup</a> for details on that.

You can, of course, use all of the built-in NodeJS stuff too.

## `ATTRS`

`ATTRS` is a data structure exposed by every worker through its `getAttributes()` function. SolexCC looks for this when it loads a worker and does a number of things to it. Here's how it should be declared:

```javascript
const ATTRS = {
    id: "test_worker",
    // Name/description
    name: "Test worker",
    description: "Does basically nothing, just illustrates the idea",
    // Does this worker want to loop?
    looper: true,
    // Mavlink messages we're interested in
    mavlinkMessages: ["HEARTBEAT", "GLOBAL_POSITION_INT"]
};

exports.getAttributes = function() { return ATTRS; }
```

Note that this **_must_** be a data structure as shown here, and not just returning a constant from a function. You'll refer to `ATTRS` a lot in your worker code. The load process instruments `ATTRS` with a bunch of extra things you'll need.

### `ATTRS` injected functions

SolexCC injects some functions into this object so your worker can interact with the rest of the system:

-	`sendMavlinkMessage(workerId, msg)`

	Sends the specified Mavlink message to the vehicle. The `workerId` argument is required. 

-	`sendGCSMessage(workerId, msg)`

	Sends the specified message to the GCS. The `workerId` argument is required, as is an `id` attribute on the message itself so it can be identified by the GCS. This is the way a worker communicates with the GCS. You'll typically call it like this:

	```javascript
	ATTRS.sendGCSMessage(ATTRS.id, {
		id: "some_message_for_the_gcs",
		some_value: "Hi there!",
		and_other_stuff: "as appropriate"
	});
	```

-	`broadcastMessage(workerId, msg)`

	Broadcasts the specified message to all running/enabled workers except the one sending it. Useful if you have a group of workers that all "speak the same language" and have a set of messages they act on in a coordinated way.

	```javascript
	ATTRS.broadcastMessage(ATTRS.id, {
		id: "some_broadcast_message",
		current_time_ms: new Date().getTime()
	});
	```

	Workers will get the broadcast message in their `onGCSMessage(msg)` function.

-	`getWorkerRoster(workerId)`

	Returns an array of all workers on the system. `workerId` is required, and is the ID of the calling worker. Pass `null` if you want the results to include the calling worker.

	```javascript
	const others = ATTRS.getWorkerRoster(ATTRS.id);
	others.map(function(worker) {
		// do stuff with worker 
	});
	```

-	`findWorkerById(workerId)`

	Returns a `worker` with the given id if present on the system.

	```javascript
	// Spray some water via "spray_gun" if available
	const gun = ATTRS.findWorkerById("spray_gun");
	if(gun && gun.spray) {
		gun.spray();
	}
	```

-	`findWorkersInPackage(packageId)`

	Returns an array of workers that are part of the specified package.

-	`subscribeMavlinkMessages(workerId, messages)`

	Set (or change) the Mavlink messages this worker wants to hear while running. `workerId` is the ID of the calling worker, and `messages` is an array of message names, e.g. `[GLOBAL_POSITION_INT,HEARTBEAT]`.

-	`log`

	A function your worker can call to log messages to both the console and the web socket in the SolexCC UI to monitor log messages for your worker 
	according to a log filter.

	```javascript
	ATTRS.log(ATTRS.id, `Hello, console");
	```

## Dependency Injection

SolexCC has a `worker_lib` directory where utility libraries can go. Utility libraries are just NodeJS modules that are loaded at startup and injected into `ATTRS` for each worker as the worker is loaded. 

So suppose you have a library of functions you find useful, and you save it in a file `MyLib.js`. Put that file in the `worker_lib` directory of your SolexCC installation, and each worker will get a `MyLib` attribute on the `api` attribute of `ATTRS`. You can then call the function like this:

```javascript
const something = ATTRS.api.MyLib.someFunctionIMadeForStuff();
```

...which admittedly looks a bit messy. If you'd like to shorten the syntax for that sort of thing, you can do this:

```javascript
// At module scope:
var MyLib;
```

```javascript
function onLoad() {
	MyLib = ATTRS.api.MyLib;
}
```

```javascript
// Somewhere in your code:
MyLib.doSomethingCool(42);
```

## Exports

A worker can export various functions to get basic functionality. They are:

-	`loop()` Called repeatedly at regular intervals. Be careful trying to do too much in this function, it needs to return quickly to maintain good performance in the NodeJS process. And obviously, calling `console.log("hey I'm in the loop() function")` is going to get annoying _fast_.

-	`onLoad()` Called when a worker is loaded. This is the "constructor" of your worker. Do stuff here to initialize your worker.

-	`onUnload()` This is the "destructor" of your worker. Do stuff here to shut your worker down gracefully.

-	`onGCSMessage(msg)`: **This is the big one.** This is essentially the command-side interface of your worker. It's the function that gets called whenever the GCS (or another worker) sends you a message to act on.

	The format of `msg` here is as follows:

	```json
	{ 
		"id": "some_message_id",
		"other_attributes": "something something blah blah blah"
	}
	```

	Your worker acts on these messages by doing something. For example, if your worker `lights` controls some lights, you might define a message called `on` which takes some optional parameters describing _how_ to turn the lights on (color, intensity, flash pattern, etc). `msg` would contain attributes describing that, and this is where your worker gets the message from Solex or another GCS telling it to turn the lights on.

	```javascript
	switch(msg.id) {
		case "on": {
			if(!turnLightsOn(msg.color, msg.intensity)) {
				result.ok = false;
				result.message = "Wasn't able to turn the lights on.";
			}
			break;
		}

	}

	return result;

	```

	**Return Value** The format for the return value from this is simple:

	```javascript
	const result = {
		ok: true
	};
	```

	If whatever you were told to do actually worked out, leave `ok` at `true` and return `result` from the function. If something went wrong, do something like this:

	```javascript
	try {
		do_something();
	} catch(ex) {
		// Oops something went sideways
		result.ok = false;
		result.message = ex.message;
	}
	```

-	`onMavlinkMessage(msg)` This is called whenever the vehicle sends one of the Mavlink messages your worker has expressed interest in. Find out which
	message is being sent by looking at `name`: 

	```javascript
	switch(msg.name) {
		case "GLOBAL_POSITION_INT": {
			// Do stuff with msg.lat, msg.lng, msg.alt, etc
			break;
		}
	}
	```

-	`onRosterChanged()`: Called when a new worker is installed, or an existing one removed.

-	`onScreenEnter(screen)` If you expose this function, it's called when a screen is entered on the GCS side. This is your worker's chance to send a UI to display. There's a ton of this sort of thing in the examples, showing how to generate screens.

-	`onImageDownload(name)` This is optional, and only called when your worker sends a GCS message indicating the presence of a download to perform. This is the function that returns the actual data required to fill the request. `name` specifies the 

-	`getFeatures()` This is implemented by workers that want to describe specific features or sub-features of features. See the `mission_support` worker example to see how this works.

## Deploying a worker

So you've made a worker, and you want to put it on the vehicle and try it out. That's pretty easy. Just go into the directory where your worker project is, and zip it up:

`zip my_worker.zip *`

...taking care, of course, to not include any files you don't want to deploy.

After that, just use the SolexCC UI. On the Workers page, click Install, select the .zip file you created, and hit OK. 

## Worker Packages

If you have a family of related workers, you can group them together into packages, and install/remove them from SolexCC all at once. 

To create a package, just group all of your worker project directories under a top-level directory. In the top-level directory, put a file called `manifest.json` that looks like this:

```json
{
	"id": "my_package",
	"name": "My Package",
	"description": "A package of my stuff, installed and removed all at once."
}
```

To deploy a package, zip up the entire directory so that `manifest.json` is at the root of the zip file:

```
# from the root of your package directory
$ zip -r9 my_package.zip *
```

(Be sure to exclude `node_modules` and other stuff from the zip file.)

Installing a package is the same as installing a normal worker, except everything in all of the subdirectories of your package will be installed at once. 

You can selectively enable/disable workers within a package, or the entire package at once, from the SolexCC UI.

