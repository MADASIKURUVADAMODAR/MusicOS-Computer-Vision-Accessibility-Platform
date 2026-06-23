import customtkinter as ctk
from tkinter import filedialog
import os
import vlc

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

app = ctk.CTk()
app.title("MusicOS")
app.geometry("1000x600")

songs = []

player = vlc.MediaPlayer()

def import_folder():

    folder = filedialog.askdirectory()

    if not folder:
        return

    songs.clear()

    playlist.delete("1.0", "end")

    count = 0

    for root_dir, dirs, files in os.walk(folder):

        for file in files:

            if file.lower().endswith(
                (".mp3", ".wav", ".flac", ".m4a")
            ):

                full_path = os.path.join(root_dir, file)

                songs.append(full_path)

                playlist.insert(
                    "end",
                    file + "\n"
                )

                count += 1

    song_label.configure(
        text=f"{count} Songs Imported"
    )


def play_song():

    if len(songs) == 0:
        return

    song = songs[0]

    player.set_media(
        vlc.Media(song)
    )

    player.play()

    song_label.configure(
        text=os.path.basename(song)
    )


def pause_song():
    player.pause()


# Sidebar
sidebar = ctk.CTkFrame(app, width=200)
sidebar.pack(side="left", fill="y")

title = ctk.CTkLabel(
    sidebar,
    text="🎵 MusicOS",
    font=("Arial", 24, "bold")
)
title.pack(pady=20)

import_btn = ctk.CTkButton(
    sidebar,
    text="Import Folder",
    command=import_folder
)
import_btn.pack(pady=10)

# Main Area
main = ctk.CTkFrame(app)
main.pack(side="right", fill="both", expand=True)

song_label = ctk.CTkLabel(
    main,
    text="No Song Playing",
    font=("Arial", 24)
)
song_label.pack(pady=30)

controls = ctk.CTkFrame(main)
controls.pack(pady=20)

prev_btn = ctk.CTkButton(
    controls,
    text="⏮"
)
prev_btn.pack(side="left", padx=10)

play_btn = ctk.CTkButton(
    controls,
    text="▶",
    command=play_song
)
play_btn.pack(side="left", padx=10)

pause_btn = ctk.CTkButton(
    controls,
    text="⏸",
    command=pause_song
)
pause_btn.pack(side="left", padx=10)

next_btn = ctk.CTkButton(
    controls,
    text="⏭"
)
next_btn.pack(side="left", padx=10)

playlist = ctk.CTkTextbox(
    main,
    width=700,
    height=300
)
playlist.pack(pady=20)

app.mainloop()