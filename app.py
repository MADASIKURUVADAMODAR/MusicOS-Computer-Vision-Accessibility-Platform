import cv2
import mediapipe as mp

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

tip_ids = [4, 8, 12, 16, 20]

cap = cv2.VideoCapture(0)

with mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
) as hands:

    while True:

        success, frame = cap.read()

        if not success:
            break

        frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        results = hands.process(rgb)

        if results.multi_hand_landmarks:

            for hand in results.multi_hand_landmarks:

                mp_draw.draw_landmarks(
                    frame,
                    hand,
                    mp_hands.HAND_CONNECTIONS
                )

                landmarks = hand.landmark

                fingers = []

                # Thumb
                if landmarks[4].x < landmarks[3].x:
                    fingers.append(1)
                else:
                    fingers.append(0)

                # Other fingers
                for tip in tip_ids[1:]:
                    if landmarks[tip].y < landmarks[tip - 2].y:
                        fingers.append(1)
                    else:
                        fingers.append(0)

                count = sum(fingers)

                if count == 0:
                    gesture = "PAUSE"
                elif count == 5:
                    gesture = "PLAY"
                else:
                    gesture = f"Fingers: {count}"

                cv2.putText(
                    frame,
                    gesture,
                    (50, 100),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    1,
                    (0, 255, 0),
                    3
                )

        cv2.imshow("MusicOS", frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

cap.release()
cv2.destroyAllWindows()