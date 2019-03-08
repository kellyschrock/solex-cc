# SolexCC Overview

SolexCC is designed to run on a drone's companion computer, and host "workers" which perform various actions. This can include monitoring the vehicle's movements and activities through Mavlink messages, _controlling_ the vehicle through Mavlink messages, interfacing with hardware (sensors, lights, cameras, etc) attached to the vehicle, and whatever else you need to do. Think of SolexCC as an "app environment" for your drone.

It _sort of_ has this in common with the environment that runs on the 3DR Solo's companion computer. For those of you who don't know, the 3DR Solo is a classic drone from the good old days which has out-lasted many other machines on the market due to its extensible nature, awesome color scheme and vibrant user community (which includes Matt Lawrence).

Like the Solo, SolexCC provides an additional communication channel between the vehicle and a GCS, and provides a software interface to potentially many different functions on the vehicle.

Where SolexCC **differs** from Solo's environment is kind of important. 

## Terrible Smart Shot on Solo

Suppose you come up with a new smart shot for your Solo. Something that, when activated, spins the Solo around on the yaw axis violently and takes pictures while moving the gimbal up and down for 1 minute, reporting progress as it goes. We'll call it the "Terrible Smart Shot". 

So, you write the Terrible Smart Shot, and want to see if it works "properly" on the Solo. To do this, you must:

1.	SCP the relevant .py files to the Solo and modify `ShotManager.py` to incorporate `Terrible.py` into the system. 
2.	Add new messages to report progress to the GCS as `Terrible.py` does its thing.
3.	Modify the GCS to accommodate these messages and display a UI to show progress to the user.
4.	Incorporate the UI and message-handling logic into the Shot Manager on the GCS.
5.	Test.
6.	Repeat relevant steps above until everything works.

It's all possible (assuming you have a GCS you can modify), but obviously kind of a task. If you don't give up and just decide to fly like an idiot manually, you at least have a way to distribute your work once it's done by making an update package in Solex to install it on other peoples' Solos.

## Terrible Smart Shot on SolexCC

The steps for SolexCC are a bit different.

1.  Create your "Terrible Smart Shot" worker using the included APIs to spin the vehicle on the yaw axis and send Mavlink messages to tilt the gimbal up and down and take pictures. Test it locally if you like, to get the basics working.
2.	Package the worker up in a zip file called something like `terrible.zip`, including all of the relevant libraries you need.
3.	Open the SolexCC UI, click "Install", pick the `terrible.zip` file, and click OK.
4.	The Worker list in the SolexCC web page now includes a "Terrible Smart Shot" entry.
5.	Start Solex and get connected.
6.	Open up the Flight Screen. Assuming you provided a UI for your Terrible Smart Shot in the appropriate place, you'll see a "Terrible" button somewhere.
7.	Fly to a safe altitude, and press whatever "Start" button you defined to activate your terrible smart shot.
8.	Test, and repeat whatever relevant steps above are needed to make it work properly. All good? Move to the next step.
9.	Watch in wonder as your vehicle runs your terrible smart shot.

If you want to distibute it, you can do that over Github. Or you can publish it to the "Workers Unite!" app-store environment in Solex (once it exists, and a less-stupid name than "Workers Unite!" is chosen for it) to share your evil genius with the world. It's up to you.

Some things to note here:

-	First, maybe using Smart Shots as an example is a bad idea. At the time of this writing, there is interest specifically in Smart Shots, so that's arguably one reason for them being the example here. But this sort of thing applies to anything you might want to stick on your vehicle. If you have a set of RGB LEDs that can change color according to what a Pi tells them to do, then you can write a worker interface to control them, and provide a _user_ interface to let you control them from the GCS on the ground, without modifying the GCS itself. That's kind of cool.

-	This all happens on a $35 Raspberry Pi and not on a Solo's IMX (unless you manage to get SolexCC running on a Solo). SolexCC is made for theoretically _any_ vehicle (including planes, rovers, etc) that can accommodate a small companion computer, and not necessarily Solos.

-	The exact details of "take pictures" mentioned above depends entirely on your camera. If you have a camera that provides a USB, serial port, or WiFi interface for controlling it, you can most likely control not only when it takes pictures, but video recording, zoom, etc as well. The good news is that you can actually _do_ it. There are plenty of examples on the internet for doing things like this with cameras and Raspberry Pis. 

-	The "UI" and "messages" bit of this is, again, up to you. Solex supports the idea that workers themselves are able (actually, _required_) to provide their own user interface to display on Solex's various screens. This is how you provide a user interface for your workers in Solex. As for the messages, their basic structure is defined by SolexCC, but can contain a wide variety of information. The idea here is to be flexible.

-	In any case, it's important to remember that SolexCC isn't just "Smart shots on machines that aren't Solos". It enables more than that. 

For example, suppose you have some sort of specialized sensor (e.g. a methane sensor or something) on your drone and you want to capture data from it, log it, and make it available to a user in a specific format. You could write specific code to interface with the methane sensor, collect the data, and log it in whatever format is appropriate. 

SolexCC has this part in common with any other implementation, to be honest. Running on something like a Raspberry Pi or TX2, you have hardware ports you can connect things to, and use readily-available code (or write your own) to interface with both your external hardware and the vehicle itself through Mavlink. As with any decent companion computer, you can write code to run on it to do things on your vehicle.

If you're going with a "roll your own" approach, you then need some way of communicating this data to the GCS so the user can see what's being gathered. So you have to build that part and come up with a scheme for getting that data to the GCS. Then you have to build a GCS that makes use of that data.

With SolexCC, you also get a set of communication channels for interacting with a GCS, including a way to tell the GCS what to display on its screens, and when, and what to do when the user interacts with those things. Essentially, you get the ability to make your vehicle interact directly with the pilot or other users. So, yeah. More than just smart shots.

