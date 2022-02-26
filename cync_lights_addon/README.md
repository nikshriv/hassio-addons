# Cync Lights Addon
## About
A Home Assistant add-on to enable monitoring and control of Cync dimmer light switches. This works in conjunction with Cync Room Lights custom integration. I only own Cync dimmer switches, so I am sure it works with them. I do not own Cync on-off switches or bulbs, but I believe the addon should work with them as well. 

With this integration, I use Google Assistant to control the switches, so you will need to link your Cync account to Google Home. This seems to be the most reliable way to control these switches. 

## Installation
1. Add this repository, https://github.com/nikshriv/hassio-addons, to your add-on store.
2. Install and start the addon
3. Create a Google account or use your own (I recommend creating a new account)
4. Download and install the Google Home app on your mobile device and link your Cync account to Google Home 
5. Create a developer project Google assistant by following the instructions at this link: https://developers.google.com/assistant/sdk/guides/service/python/embed/config-dev-project-and-account
6. Be sure to add your Google account email address under the "Test Users" section
7. Make sure that once when you configure the "Oauth Consent Screen: that you select "Publish App" under Publishing status
8. Save your client secret file to paste when logging into the Cync Lights integration
9. At the end of the Developer Project configuration page, click "Register the Device Model" and enter model information (it doesn't matter what you enter here)
10. Finally, download your Oauth2.0 credentials and save the file.
11. Add the Cync Lights Integration custom component repository to HACS and install it. (https://github.com/nikshriv/cync_lights)
12. Log in with your Cync credentials and enter your 2-factor code if required.
13. When prompted for your client secret, copy and paste the entire contents of your previously save Oauth2.0 credentials
14. Paste the Google authentication code when prompted
