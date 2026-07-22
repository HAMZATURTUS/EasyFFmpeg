import { useState } from "react";
import { open } from '@tauri-apps/plugin-dialog';
// import reactLogo from "./assets/react.svg";
// import { invoke } from "@tauri-apps/api/core";
import "./App.css";


function ConvertPage() {

  async function select_file() {
    const file = await open({
      multiple: false,
      directory: false,
    });

    var display = document.getElementById("file-path-display") as HTMLInputElement
    if (file && display) {
      display.value = file;
    }
  }

  return (
    <div className="page-view">
      <h2>Convert Video Format</h2>
      <p>Select a file and choose a new format (e.g., MKV to MP4).</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="internal-row">
          <button
          onClick={() => {
            select_file();
          }}
          className="share-btn" id="open-dialog-btn">Select File</button>
          <input type="text" className="share-btn" id="file-path-display" readOnly placeholder="No file selected..." />
        </div>
        <div className="internal-row">
          <label>Choose a new format: </label>
          <select name="fformats" id="fformats">
            <option value="mp4">mp4</option>
            <option value="avi">avi</option>
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
          </select>
        </div>
        <button type="submit">Convert</button>
      </form>
    </div>
  );
}

function TrimPage() {
  return (
    <div className="page-view">
      <h2>Trim Video</h2>
      <p>Set a start time and end time to cut a clip.</p>
      {/* You will add your time inputs here later */}
    </div>
  );
}

function HomePage() {
  return (
    <div className="page-view">
      <h2>Welcome to FFmpeg GUI</h2>
      <p>Select a tool from the menu above to get started.</p>
    </div>
  );
}

function App() {
  // This state tracks which tool the user wants to see. 
  // We default to "home".
  const [activeTab, setActiveTab] = useState("home");

  // This helper function looks at the state and returns the correct component
  const renderContent = () => {
    switch (activeTab) {
      case "convert":
        return <ConvertPage />;
      case "trim":
        return <TrimPage />;
      default:
        return <HomePage />;
    }
  };

  return (
    <main className="container">
      <h1>Video Toolkit</h1>

      {/* Navigation Menu */}
      <div className="row">
        <button 
          onClick={() => setActiveTab("home")}
          className={activeTab === "home" ? "active" : ""}
        >
          Home
        </button>
        <button 
          onClick={() => setActiveTab("convert")}
          className={activeTab === "convert" ? "active" : ""}
        >
          Convert
        </button>
        <button 
          onClick={() => setActiveTab("trim")}
          className={activeTab === "trim" ? "active" : ""}
        >
          Trim
        </button>
      </div>

      {/* The Active Page Renders Here */}
      <div className="content-area">
        {renderContent()}
      </div>

    </main>
  );
}

/*
function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>
      <p>{greetMsg}</p>
    </main>
  );
}
*/

export default App;
