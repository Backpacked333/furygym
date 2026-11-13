# Gym TV display: setup and acceptance

The display is a web page, not a TV app. A device in the gym opens the display link in a browser
and leaves it running; coaches control what it shows from **Displays** in the staff console.

## What it shows, and where it comes from

| On screen | Source |
| --- | --- |
| Today's workouts | Published workouts in the gym's time zone. Drafts and future workouts never appear |
| Class card | The class on the floor until it ends; from 15 minutes before the next class starts, that class and its countdown. Classes more than three hours away are not shown |
| Checked in | Bookings and check-ins recorded in this app only. Names are off by default; when on, first name and last initial |
| Message banner | Typed by staff in Displays |

Attendance kept in another system (for example Wodify) does not reach the screen. If bookings and
check-in stay there, leave names off; the roster card is hidden when a class has no bookings here.

## Setting up a screen

1. Use a device that stays on and runs a current Chrome, Edge or Safari: a small computer on the
   TV's HDMI input is the dependable choice. A TV's built-in browser is untested.
2. In the staff console open **Displays**, copy the display link, and open it full screen (kiosk mode).
3. Set the device to start the browser on that link after a restart, and to never sleep.
4. Set the gym's time zone correctly in the console. The countdown uses the server's clock, so a
   wrong clock on the device does not matter.

All screens on the link show the same thing. Separate content per room is not supported.

## What staff can rely on

- Changes made in Displays reach every screen within 30 seconds.
- **Screens** in Displays shows *Connected* only while a screen has checked in during the last
  90 seconds, and the time of the last check-in. It reports that at least one screen is on the
  link, not how many or which. Opening the preview from the console does not count.
- If the connection drops, the screen keeps the last workout, shows
  "Offline · last updated …" and reconnects by itself. After the gym's midnight it stops showing
  the previous day's workout. A screen that is restarted with no connection shows nothing.
- **New link** makes the old link stop working: screens on it go blank within 30 seconds and say
  the link is no longer active. Use it if the link has been shared outside the gym.
- A long workout is shrunk to fit, down to half size. If the day's workouts still do not fit, the
  screen says so and the bottom is cut off: show one track, or pin one workout.

## Acceptance test in the gym

Run this on the real device and network before relying on the screen. None of it has been done
on gym hardware yet.

1. Publish a workout for today: it appears within 30 seconds. A draft does not.
2. Read the longest real workout from the back of the room.
3. Before, during and after a class the card shows the countdown, "In progress" until the real end
   time, then the next class.
4. Unplug the network for two minutes: the workout stays, the offline note appears, then clears.
5. Restart the device: the display comes back without anyone touching it.
6. **Screens** in Displays says *Connected*; switch the device off and it says *Not connected*
   within two minutes.
7. Create a new link: the screen goes blank within 30 seconds. Open the new link on it.
