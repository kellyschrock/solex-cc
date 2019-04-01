# SolexCC Setup

Here's where you set things up and get them working.

## Things You'll Need

-	2 Raspberry Pi Model 3 B or B+.
-	2 SD Cards. 16GB or 32GB is a good choice.
-	A vehicle with a Pixhawk and room on it for a Pi.
-	A battery pack for powering a Pi. Something like this can do that for _4 days_: https://www.amazon.com/gp/product/B074J2T48W/ref=ppx_yo_dt_b_asin_title_o03_s00?ie=UTF8&psc=1
-	A Pi case for the base station: https://www.amazon.com/gp/product/B01F1PSFY6/ref=ppx_yo_dt_b_asin_title_o03_s01?ie=UTF8&psc=1
-	Some wire for connecting one of the Pi's to your Pixhawk.
-	Basic soldering ability.

## Vehicle Hardware Setup

**Obvious first step:** Put one of the Pi's on your vehicle. Connect it in the standard way as described here: http://ardupilot.org/dev/docs/raspberry-pi-via-mavlink.html

A similar approach can be used with other companion computers. The gist of it is getting a serial port connected to the serial output of the flight controller for Mavlink messages. For now, we're messing with Pi's.

## Vehicle Software Setup

Having done the hardware setup, put the included SolexCC-Vehicle.img file on a 32GB SD card and insert it into the SD card slot on your vehicle's Pi.
(Don't turn it on yet, there's still more to do.)

## Base Station Setup

Out of the box, the SolexCC image runs as a station on a WiFi network. This is much preferred over running the vehicle as the access point. WiFi range
being what it is, you're likely to go out of range occasionally while flying around. When that happens, the lost connection between the vehicle and the GCS will recover much more gracefully if there's an access point that remains in place during the lost connection. 

Install the SolexCC-BaseStation image on another 16GB SD card and put it in the second Pi. Put it in the case, hook up a power supply, and there you go.
You now have an access point for the vehicle to connect to.

When you power on your vehicle, it should connect after about 15 seconds or so. The easiest way to check this is to join the "SolexCC-Base" WiFi (password is `solexccbase`) and then navigate with a browser to http://10.0.0.10. If you see the SolexCC page pop up, you're connected. 

Out of the box, you should see several workers installed. These are sort of do-nothing workers that demonstrate various features and make it convenient
to test that everything's communicating properly.

### Internet access

Some workers have dependencies that have to be installed in place on the vehicle. To do that, the vehicle needs to be on a connection with internet access. The SolexCC-Base device can provide that by plugging an Ethernet cable into it from your home-network router. That way when you install a worker with dependencies that have to be downloaded, it can do so.

### Solex Setup

Solex tries to connect to your companion computer when it connects to a vehicle's Mavlink stream via UDP, but only if you tell it to. To do that, you first need a connection to edit. So in Solex, click "WiFi Settings" and join the SolexCC-Base network. Press Back to get back into Solex, and press "Connect", with "UDP" selected.

After a few seconds, Solex should connect to the vehicle and download parameters.

Now you have a vehicle connection.

Go into the "Vehicles" screen from the main menu, and find the "SolexCC-Base" vehicle. There's a checkbox, **CC Configuration**. Click that so it's turned on, and specify the IP address and port of the companion computer there. In this case, 10.0.0.10 for the IP address, and 80 for the port. 

Then press **SET** to save it.

If you're connected to your vehicle, click "Disconnect" on the main screen to disconnect. Then connect again. After a few seconds, you should see a message at the bottom of the screen saying "CC WebSocket connected". This indicates that Solex has connected to the SolexCC instance running on your vehicle. Yay!

From there, what Solex with SolexCC does is mainly a matter of what workers you have installed on your vehicle. 

