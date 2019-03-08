# Setting up a Development Environment

Here's where you learn how to set up a development environment to make it easier to build workers.

## Install SolexCC on your computer

The first step, obviously, is knowing how to use Github, and how to ensure you have NodeJS installed on your computer. If those things are beyond you, maybe go learn about those things, and then return to...

...this part.

Great, so you have SolexCC on your computer.

Open a terminal, go into the `app` directory under SolexCC, and run this command:

`node app.js`

You're now running SolexCC.

If you want to mess around with the example workers that come with SolexCC, locate the `config.json` file and set it so it looks like this:

```json
{
    "dispatcher": {
        "worker_roots": [
            "(Directory where you installed SolexCC example workers)"
        ],
        "worker_lib_root": "worker_lib",
        "sysid": 221,
        "compid": 101,
        "loop_time_ms": 1000,
        "udp_port": 14550
    }
}

```

In the terminal where you started SolexCC, press Ctrl+C and then run `node app.js` to start it again.

Open up a browser and navigate to http://localhost:3000, and you'll see the SolexCC UI in a web page. From there, you can mess around with the installed workers, enabling and disabling them however you like.

## Solex Setup

You'll want to see how things look in Solex as you go, ideally without having to have a copter or something sitting beside you idling so you can deploy workers to its companion computer. You can fool Solex into connecting to the SolexCC instance on your computer by creating a configuration file on the device where Solex is running, at this location:

```
/sdcard/Solex/cc/cc.conf
```

You need to put your computer's IP address into this file. Run `ifconfig -a` to find your computer's IP address, and then put that and the port number `3000` into a file so it looks like this:

```
192.168.1.56:3000
```

**Launch Solex.** Open the main menu, and you should see "Connect SolexCC" menu item under "Vehicle". Click it. You should see a "CC Websocket Connected" message appear. That means, unsurprisingly, that you've connected. What happens next is largely up to the workers that are installed and enabled. 

(**Note** that the "Connect SolexCC" menu item is only visible when you're not connected to a vehicle. When you are, the CC configuration on the vehicle supercedes the local CC configuration.)

That's basically it. Now you can see what your workers are doing in Solex.


