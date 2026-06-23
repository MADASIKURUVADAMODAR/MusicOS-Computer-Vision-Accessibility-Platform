import pygame
import tkinter as tk
from tkinter import filedialog
import os

pygame.mixer.init()

root = tk.Tk()
root.title("MusicOS")
root.geometry("700x500")

songs = []

def import_folder():
    global songs

    folder = filedialog.askdirectory()

    if not folder:
        return

    song_list.delete(0, tk.END)
    songs.clear()

    for root_dir, dirs, files in os.walk(folder):
        for file in files:

            if file.lower().endswith((".mp3", ".wav", ".flac", ".m4a")):

                full_path = os.path.join(root_dir, file)

                songs.append(full_path)

                song_list.insert(tk.END, file)

def play_song(event):

    selected = song_list.curselection()

    if not selected:
        return

    index = selected[0]

    song_path = songs[index]

    pygame.mixer.music.load(song_path)
    pygame.mixer.music.play()

    print("Playing:", song_path)

import_btn = tk.Button(
    root,
    text="Import Folder",
    font=("Arial", 14),
    command=import_folder
)

import_btn.pack(pady=20)

song_list = tk.Listbox(
    root,
    width=90,
    height=20
)

song_list.pack(pady=10)

song_list.bind("<Double-Button-1>", play_song)

root.mainloop()