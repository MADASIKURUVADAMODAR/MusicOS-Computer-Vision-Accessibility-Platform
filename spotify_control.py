import spotipy
from spotipy.oauth2 import SpotifyOAuth

CLIENT_ID = "fd19155009594391a956efb08efdd1ce"
CLIENT_SECRET = "6f26719c0b8c4c389f573f6ffbf07edc"

sp = spotipy.Spotify(
    auth_manager=SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri="http://127.0.0.1:8888/callback",
        scope="user-read-playback-state user-modify-playback-state"
    )
)

print("\nGetting Spotify devices...\n")

devices = sp.devices()

print("Devices Found:")
print(devices)

try:
    sp.pause_playback()
    print("\n✅ PAUSE command sent successfully!")
except Exception as e:
    print("\n❌ Error while pausing:")
    print(e)

input("\nPress Enter to exit...")