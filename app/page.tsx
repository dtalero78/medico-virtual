"use client";
import React, { useState, useRef, useEffect } from "react";

const App: React.FC = () => {
  const [voice, setVoice] = useState("ash");
  const [status, setStatus] = useState("");
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [userData, setUserData] = useState<any>(null); // Almacena datos del paciente
  const audioIndicatorRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null); // Referencia al WebSocket

  // ✅ Cerrar sesión al desmontar el componente
  useEffect(() => {
    return () => stopSession();
  }, []);

  // ✅ Conectar WebSocket con reconexión automática
  useEffect(() => {
    const connectWebSocket = () => {
      const socket = new WebSocket("ws://localhost:3000");

      socket.onopen = () => {
        console.log("✅ Conexión WebSocket establecida.");
        socket.send(JSON.stringify({ event: "start" }));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.event === "userData") {
          console.log("✅ Datos del paciente recibidos:", message.data);
          setUserData(message.data);
        }
      };

      socket.onerror = (error) => {
        console.error("❌ Error en WebSocket:", error);
      };

      socket.onclose = (event) => {
        console.warn(
          `❌ Conexión WebSocket cerrada. Código: ${event.code}, Razón: ${event.reason}`
        );
        setTimeout(connectWebSocket, 1000); // Reconexión automática
      };

      socketRef.current = socket;
    };

    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // ✅ Obtener Token Ephemeral
  const getEphemeralToken = async () => {
    try {
      if (!userData) {
        throw new Error("No hay datos del usuario disponibles para la sesión.");
      }

      setStatus("Obteniendo token...");
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          primerNombre: userData?.primerNombre || "Desconocido",
          profesionUOficio: userData?.profesionUOficio || "Desconocido",
          encuestaSalud: userData?.encuestaSalud || "Desconocido",
          antecedentesFamiliares: userData?.antecedentesFamiliares || "Sin información",
        }),
      });

      const data = await response.json();
      if (!data.client_secret?.value) {
        throw new Error("No se recibió un token válido");
      }
      setStatus("Token obtenido correctamente");
      return data.client_secret.value;
    } catch (error) {
      console.error("❌ Error al obtener el token:", error);
      setStatus("Error al obtener el token");
      return null;
    }
  };

  // ✅ Iniciar Sesión
  const startSession = async () => {
    try {
      if (!userData) {
        throw new Error("No hay datos del usuario disponibles.");
      }

      setStatus("Solicitando acceso al micrófono...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      setStatus("Obteniendo token...");
      const ephemeralToken = await getEphemeralToken();
      if (!ephemeralToken) {
        throw new Error("Token no disponible");
      }

      setStatus("Estableciendo conexión...");
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;

      pc.ontrack = (e) => (audioEl.srcObject = e.streams[0]);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Crear una oferta SDP con opciones explícitas
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
      });
      await pc.setLocalDescription(offer);

      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";

      const response = await fetch(`${baseUrl}?model=${model}&voice=${voice}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralToken}`,
          "Content-Type": "application/sdp",
        },
      });

      const answer = await response.text();

      await pc.setRemoteDescription({
        type: "answer",
        sdp: answer,
      });

      peerConnectionRef.current = pc;
      setIsSessionActive(true);
      setStatus("Sesión establecida correctamente");
    } catch (err) {
      console.error("❌ Error al iniciar la sesión:", err);
      setStatus(
        `Error: ${err instanceof Error ? err.message : "Error desconocido"}`
      );
      stopSession();
    }
  };

  // ✅ Detener Sesión
  const stopSession = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }

    setIsSessionActive(false);
    setStatus("Sesión detenida");
  };

  return (
    <div>
      <button
        onClick={isSessionActive ? stopSession : startSession}
        className={`px-6 py-3 text-white font-bold ${
          isSessionActive ? "bg-red-500" : "bg-blue-500"
        }`}
      >
        {isSessionActive ? "Stop Chat" : "Start Chat"}
      </button>
    </div>
  );
};

export default App;
