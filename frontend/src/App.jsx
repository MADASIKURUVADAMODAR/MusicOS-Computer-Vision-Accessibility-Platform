import { useState, useEffect, useRef } from "react";
import { parseBlob } from "music-metadata";
import Webcam from "react-webcam";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

function App() {
  // Load persistent user configurations directly from browser data stores on mount
  const [songs, setSongs] = useState([]);
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem("favorites");
    return saved ? JSON.parse(saved) : [];
  });
  const [recentSongs, setRecentSongs] = useState(() => {
    const saved = localStorage.getItem("recentSongs");
    return saved ? JSON.parse(saved) : [];
  });

  const [gesture, setGesture] = useState("Initializing Engine...");
  const [currentSong, setCurrentSong] = useState("No Song Playing");
  const [currentArtist, setCurrentArtist] = useState("");
  const [currentAlbum, setCurrentAlbum] = useState("");
  const [coverArt, setCoverArt] = useState(null);

  const [audio, setAudio] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");

  // Spatial delta tracking variables
  const lastX = useRef(null);
  const gestureCooldown = useRef(false);
  
  // State lock to prevent machine-gun trigger looping on static hand shapes
  const lastGesture = useRef("");
  
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Synchronized state mirrors to prevent cross-thread engine state dropping
  const audioRef = useRef(null);
  const songsRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const volumeRef = useRef(1);
  const favoritesRef = useRef([]);

  useEffect(() => { audioRef.current = audio; }, [audio]);
  useEffect(() => { songsRef.current = songs; }, [songs]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  // Synchronize state maps cleanly down to LocalStorage layers
  useEffect(() => {
    localStorage.setItem("favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem("recentSongs", JSON.stringify(recentSongs));
  }, [recentSongs]);

  const adjustVolume = (amount) => {
    const target = Math.min(1, Math.max(0, volumeRef.current + amount));
    setVolume(target);
    if (audioRef.current) {
      audioRef.current.volume = target;
    }
  };

  // Wire up core Voice Command dictionaries
  const commands = [
    { command: ["play music", "play", "start music"], callback: () => audioRef.current?.play().catch(() => {}) },
    { command: ["pause music", "pause", "stop music"], callback: () => audioRef.current?.pause() },
    { command: ["next song", "next"], callback: () => nextSong() },
    { command: ["previous song", "previous", "back"], callback: () => prevSong() },
    { command: ["volume up", "louder"], callback: () => adjustVolume(0.15) },
    { command: ["volume down", "quieter"], callback: () => adjustVolume(-0.15) },
  ];

  const { transcript, listening, browserSupportsSpeechRecognition } = useSpeechRecognition({ commands });

  useEffect(() => {
    if (browserSupportsSpeechRecognition) {
      SpeechRecognition.startListening({ continuous: true });
    }
  }, [browserSupportsSpeechRecognition]);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      SpeechRecognition.stopListening();
    };
  }, []);

  // Initialize MediaPipe Engine asynchronously
  useEffect(() => {
    async function initMediaPipe() {
      try {
        setGesture("Loading Models...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        landmarkerRef.current = handLandmarker;
        setGesture("Ready For Gesture");
        startDetectionLoop();
      } catch (err) {
        console.error(err);
        setGesture("Model Error");
      }
    }
    initMediaPipe();
    return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, []);

  // Updated: Explicitly clears active ref tracking locks and resets status displays on loop completion
  const triggerCooldown = () => {
    gestureCooldown.current = true;
    setTimeout(() => {
      gestureCooldown.current = false;
      lastGesture.current = "";
      setGesture("Ready For Gesture");
    }, 1200);
  };

  // Draw skeletal lines connecting landmarks
  const drawSkeleton = (ctx, landmarks) => {
    // Structural hand rigging map pathways anchored directly at the wrist base (0)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],       // Index
      [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17]             // Palm boundary connection
    ];

    ctx.strokeStyle = "#22c55e"; // green-500
    ctx.lineWidth = 3;
    ctx.fillStyle = "#ffffff"; // White coordinate nodes

    connections.forEach(([start, end]) => {
      if (landmarks[start] && landmarks[end]) {
        ctx.beginPath();
        ctx.moveTo(landmarks[start].x * ctx.canvas.width, landmarks[start].y * ctx.canvas.height);
        ctx.lineTo(landmarks[end].x * ctx.canvas.width, landmarks[end].y * ctx.canvas.height);
        ctx.stroke();
      }
    });

    landmarks.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x * ctx.canvas.width, point.y * ctx.canvas.height, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  // Realtime Computer Vision coordinate assessment loop
  const startDetectionLoop = () => {
    const detect = () => {
      if (
        webcamRef.current &&
        webcamRef.current.video &&
        webcamRef.current.video.readyState === 4 &&
        landmarkerRef.current &&
        canvasRef.current
      ) {
        const video = webcamRef.current.video;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        // Mutation protection prevents structural context wipes inside render loops
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        // Clear canvas context frame before redrawing state
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const startTimeMs = performance.now();
        const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
        
        if (results.landmarks && results.landmarks.length > 0) {
          const hand = results.landmarks[0];
          
          // Render tracking layer matching mirrored camera coordinate constraints
          drawSkeleton(ctx, hand);

          if (!gestureCooldown.current) {
            // Updated: Highly stable physical anchor point using the primary wrist coordinate base
            const currentX = hand[0].x;

            // 1. Updated: Mirrored axis translation tracking matching scaleX(-1) viewport constraints
            if (lastX.current !== null) {
              const diff = currentX - lastX.current;
              if (diff < -0.08) {
                if (lastGesture.current !== "NEXT") {
                  setGesture("👉 NEXT SONG");
                  lastGesture.current = "NEXT";
                  nextSong();
                  triggerCooldown();
                }
                return;
              } else if (diff > 0.08) {
                if (lastGesture.current !== "PREVIOUS") {
                  setGesture("👈 PREVIOUS SONG");
                  lastGesture.current = "PREVIOUS";
                  prevSong();
                  triggerCooldown();
                }
                return;
              }
            }
            lastX.current = currentX;

            // Compute core landmark visibility structural patterns
            const indexExtended = hand[8].y < hand[6].y;
            const middleExtended = hand[12].y < hand[10].y;
            const ringExtended = hand[16].y < hand[14].y;
            const pinkyExtended = hand[20].y < hand[18].y;

            // 2. Open Palm Check
            if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
              if (lastGesture.current !== "PLAY") {
                setGesture("✋ PLAY");
                lastGesture.current = "PLAY";
                audioRef.current?.play().catch(() => {});
                triggerCooldown();
              }
              return;
            }

            // 3. 👍 Strict Isolated Thumbs Up Matrix Logic
            const isThumbsUp = hand[4].y < hand[3].y && hand[3].y < hand[2].y && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
            if (isThumbsUp) {
              if (lastGesture.current !== "VOLUME_UP") {
                setGesture("👍 VOLUME UP");
                lastGesture.current = "VOLUME_UP";
                adjustVolume(0.10);
                triggerCooldown();
              }
              return;
            }

            // 4. 👎 Strict Isolated Thumbs Down Matrix Logic
            const isThumbsDown = hand[4].y > hand[3].y && hand[3].y > hand[2].y && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
            if (isThumbsDown) {
              if (lastGesture.current !== "VOLUME_DOWN") {
                setGesture("👎 VOLUME DOWN");
                lastGesture.current = "VOLUME_DOWN";
                adjustVolume(-0.10);
                triggerCooldown();
              }
              return;
            }

            // 5. ✌️ Peace / Two Fingers extended (Shuffle triggered)
            if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
              if (lastGesture.current !== "SHUFFLE") {
                setGesture("✌️ SHUFFLE PLAY");
                lastGesture.current = "SHUFFLE";
                shufflePlay();
                triggerCooldown();
              }
              return;
            }

            // 6. 🤟 Rock Sign (Favorite status flip action map)
            if (indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
              if (lastGesture.current !== "FAVORITE") {
                setGesture("🤟 TOGGLE FAVORITE");
                lastGesture.current = "FAVORITE";
                const currentTracks = songsRef.current;
                const currentTrackIdx = currentIndexRef.current;
                if (currentTracks[currentTrackIdx]) {
                  toggleFavorite(currentTracks[currentTrackIdx].url);
                }
                triggerCooldown();
              }
              return;
            }

            // 7. Fist Check (Safe fall-through boundary positioning preventing false micro-pauses)
            if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
              if (lastGesture.current !== "PAUSE") {
                setGesture("✊ PAUSE");
                lastGesture.current = "PAUSE";
                audioRef.current?.pause();
                triggerCooldown();
              }
              return;
            }

            // Clear lock dynamically if they switch to a transient default tracking shape
            if (
              !isThumbsUp &&
              !isThumbsDown &&
              !(indexExtended && middleExtended && ringExtended && pinkyExtended) &&
              !(!indexExtended && !middleExtended && !ringExtended && !pinkyExtended)
            ) {
              setGesture("Ready For Gesture");
              lastGesture.current = "";
            }
          }
        } else if (!results.landmarks || results.landmarks.length === 0) {
          // Global wipe state when the user takes their hand out of view
          lastX.current = null;
          if (!gestureCooldown.current) {
            setGesture("Ready For Gesture");
            lastGesture.current = "";
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(detect);
    };
    animationFrameRef.current = requestAnimationFrame(detect);
  };

  const importSongs = async () => {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: "Audio Files", accept: { "audio/*": [".mp3", ".wav", ".flac", ".m4a"] } }]
      });
      const importedSongs = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        let title = file.name, artist = "Unknown Artist", album = "Unknown Album", artwork = null;
        try {
          const metadata = await parseBlob(file);
          title = metadata.common.title || file.name;
          artist = metadata.common.artist || "Unknown Artist";
          album = metadata.common.album || "Unknown Album";
          if (metadata.common.picture && metadata.common.picture.length > 0) {
            const pic = metadata.common.picture[0];
            artwork = URL.createObjectURL(new Blob([pic.data], { type: pic.format }));
          }
        } catch (err) { console.log(err); }
        importedSongs.push({ title, artist, album, artwork, url: URL.createObjectURL(file) });
      }
      
      setSongs((prev) => [...prev, ...importedSongs]);
    } catch (err) { console.log(err); }
  };

  const playSong = (song, index) => {
    if (audioRef.current) audioRef.current.pause();
    const newAudio = new Audio(song.url);
    newAudio.volume = volumeRef.current;
    newAudio.play().catch(() => {});

    newAudio.onloadedmetadata = () => setDuration(newAudio.duration);
    newAudio.ontimeupdate = () => setCurrentTime(newAudio.currentTime);
    newAudio.onended = () => {
      const currentSongsList = songsRef.current;
      const nextIndex = (currentIndexRef.current + 1) % currentSongsList.length;
      if (currentSongsList[nextIndex]) playSong(currentSongsList[nextIndex], nextIndex);
    };

    setAudio(newAudio);
    setCurrentSong(song.title.replaceAll("%20", " ").replace(".mp3", ""));
    setCurrentArtist(song.artist);
    setCurrentAlbum(song.album);
    setCoverArt(song.artwork);
    setCurrentIndex(index);
    setRecentSongs((prev) => [song, ...prev.filter((s) => s.url !== song.url)].slice(0, 20));
  };

  const prevSong = () => {
    const list = songsRef.current;
    if (list.length === 0) return;
    const prev = (currentIndexRef.current - 1 + list.length) % list.length;
    playSong(list[prev], prev);
  };

  const nextSong = () => {
    const list = songsRef.current;
    if (list.length === 0) return;
    const next = (currentIndexRef.current + 1) % list.length;
    playSong(list[next], next);
  };

  const shufflePlay = () => {
    const list = songsRef.current;
    if (list.length === 0) return;
    const random = Math.floor(Math.random() * list.length);
    playSong(list[random], random);
  };

  const toggleFavorite = (songUrl) => {
    if (favoritesRef.current.includes(songUrl)) {
      setFavorites(favoritesRef.current.filter((f) => f !== songUrl));
    } else {
      setFavorites([...favoritesRef.current, songUrl]);
    }
  };

  return (
    <div className="h-screen bg-black text-white flex overflow-hidden">
      {/* Sidebar navigation */}
      <div className="w-64 bg-zinc-950 border-r border-zinc-800 p-6 flex flex-col justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-8">🎵 MusicOS</h1>
          <button
            onClick={importSongs}
            className="w-full bg-green-500 hover:bg-green-600 transition-colors p-3 rounded-xl font-semibold text-black mb-6"
          >
            Import Songs
          </button>
        </div>

        <div className="text-zinc-400 text-sm space-y-2 border-t border-zinc-800 pt-4">
          <p className="flex items-center gap-2">❤️ Favorites: <span className="text-white font-bold">{favorites.length}</span></p>
          <p className="flex items-center gap-2">📜 History: <span className="text-white font-bold">{recentSongs.length}</span></p>
          <p className="flex items-center gap-2">
            🎤 Voice Command: 
            <span className={`font-bold uppercase ${listening ? "text-green-400" : "text-red-500"}`}>
              {listening ? "Active" : "Off"}
            </span>
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-8 pb-36 overflow-y-auto">
        
        {/* Upper Dashboard Workspace Details */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 mb-8 bg-zinc-950 p-6 rounded-3xl border border-zinc-900">
          
          <div className="flex flex-1 gap-6 items-center w-full min-w-0">
            <img
              src={coverArt || "https://placehold.co/200x200?text=MusicOS"}
              alt="Cover Art"
              className="w-44 h-44 lg:w-52 lg:h-52 rounded-3xl object-cover flex-shrink-0"
            />

            <div className="flex-1 min-w-0">
              <h1 className="text-4xl lg:text-5xl font-bold truncate">{currentSong}</h1>
              <p className="text-xl text-zinc-400 mt-2 truncate">{currentArtist}</p>
              {currentAlbum && <p className="text-sm text-zinc-500 italic mt-1 truncate">{currentAlbum}</p>}

              {/* Progress Slider Element */}
              <div className="mt-6 w-full max-w-2xl">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (audioRef.current) audioRef.current.currentTime = value;
                    setCurrentTime(value);
                  }}
                  className="w-full accent-green-500 cursor-pointer"
                />
                <div className="flex justify-between text-zinc-400 mt-2 text-sm">
                  <span>{Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, "0")}</span>
                  <span>{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Vision Tracker Block with Realtime Canvas Skeleton Layer */}
          <div className="flex-shrink-0 bg-zinc-900 p-4 rounded-2xl border border-zinc-800 w-full lg:w-auto flex flex-col items-center">
            <div className="relative w-full max-w-xs aspect-video rounded-xl overflow-hidden">
              <Webcam
                audio={false}
                ref={webcamRef}
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
                style={{ transform: "scaleX(-1)" }}
              />
            </div>
            <p className="text-green-400 font-semibold mt-3 text-sm tracking-wide flex items-center justify-center">
              ✋ Engine State: 
              <span className="text-white bg-green-500/20 px-2.5 py-1 rounded border border-green-500/30 ml-2 font-mono uppercase tracking-wider text-xs">
                {gesture}
              </span>
            </p>
          </div>
        </div>

        {/* Dynamic Voice Feed Display Bar */}
        {transcript && (
          <div className="bg-zinc-900/50 border border-zinc-800 p-3 rounded-xl mb-4 flex items-center gap-3">
            <span className="text-zinc-400 text-xs uppercase font-bold tracking-wider">🎤 Live Speech Input:</span>
            <p className="text-sm italic text-zinc-200">"{transcript}"</p>
          </div>
        )}

        {/* Search Input Bar */}
        <input
          type="text"
          placeholder="Search songs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full p-3 rounded-xl bg-zinc-800 mb-6 focus:outline-none focus:ring-2 focus:ring-green-500 text-white"
        />

        {/* Recently Played Section */}
        {recentSongs.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 text-zinc-300">📜 Recently Played</h2>
            <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-thin">
              {recentSongs.map((song, rIndex) => {
                const originalIndex = songs.findIndex((s) => s.url === song.url);
                return (
                  <div
                    key={`recent-${rIndex}`}
                    onClick={() => playSong(song, originalIndex !== -1 ? originalIndex : 0)}
                    className="flex-shrink-0 w-36 bg-zinc-900 hover:bg-zinc-800 p-3 rounded-xl cursor-pointer transition-colors"
                  >
                    <img src={song.artwork || "https://placehold.co/120x120?text=MusicOS"} alt="" className="w-full h-28 object-cover rounded-lg mb-2" />
                    <p className="font-medium text-xs truncate">{song.title.replaceAll("%20", " ").replace(".mp3", "")}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{song.artist}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tracklist Display Grid */}
        <h2 className="text-xl font-semibold mb-4 text-zinc-300">Your Tracks</h2>
        <div className="space-y-2">
          {songs
            .filter((song) => song.title.toLowerCase().includes(searchTerm.toLowerCase()))
            .map((song, index) => (
              <div
                key={index}
                onClick={() => playSong(song, index)}
                className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${
                  currentIndex === index ? "bg-green-500/20 border border-green-500/30" : "bg-zinc-900 hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-center gap-4">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(song.url); }}
                    className="text-lg hover:scale-110 transition-transform"
                  >
                    {favorites.includes(song.url) ? "❤️" : "🤍"}
                  </button>
                  <div>
                    <p className={`font-medium ${currentIndex === index ? "text-green-400" : "text-white"}`}>
                      {song.title.replaceAll("%20", " ").replace(".mp3", "")}
                    </p>
                    <p className="text-xs text-zinc-400">{song.artist}</p>
                  </div>
                </div>
                <span className="text-xs text-zinc-500">{song.album}</span>
              </div>
            ))}
          {songs.length === 0 && <p className="text-zinc-500 text-sm italic">No tracks imported yet.</p>}
        </div>
      </div>

      {/* Fixed Bottom Layout Control Dock Component Bar */}
      <div className="fixed bottom-0 left-64 right-0 bg-zinc-900 border-t border-zinc-800 p-4 flex items-center justify-between z-10">
        <div className="font-bold max-w-xs truncate" title={currentSong}>{currentSong}</div>
        <div className="flex gap-4">
          <button onClick={prevSong} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-lg transition-colors">⏮</button>
          <button onClick={shufflePlay} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-lg transition-colors">🔀</button>
          <button onClick={() => audioRef.current?.play().catch(() => {})} className="bg-green-500 hover:bg-green-400 text-black font-bold px-4 py-2 rounded-lg transition-colors">▶</button>
          <button onClick={() => audioRef.current?.pause()} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-lg transition-colors">⏸</button>
          <button onClick={nextSong} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-lg transition-colors">⏭</button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-400">🔊</span>
          <input
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (audioRef.current) audioRef.current.volume = v;
            }}
            className="accent-green-500 cursor-pointer w-24"
          />
        </div>
      </div>
    </div>
  );
}

export default App;