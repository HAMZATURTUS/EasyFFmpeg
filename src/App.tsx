import { useState } from "react";
import { open } from '@tauri-apps/plugin-dialog';
// import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

async function select_file() {
  const file = await open({
    multiple: false,
    directory: false,
  });

  const display = document.getElementById("file-path-display") as HTMLInputElement;
  if (file && display) {
    display.value = file;
  }
}

async function select_location() {
  const file = await open({
    multiple: false,
    directory: true,
  });

  const display = document.getElementById("dir-path-display") as HTMLInputElement;
  if (file && display) {
    display.value = file;
  }
}

interface props {
  isWorking: boolean;
  setIsWorking: React.Dispatch<React.SetStateAction<boolean>>;
}

function ConvertPage({ isWorking, setIsWorking }: props) {
  async function convert_filetype() {
    if (isWorking) return;
    setIsWorking(true);

    const fp_display = document.getElementById("file-path-display") as HTMLInputElement;
    const dp_display = document.getElementById("dir-path-display") as HTMLInputElement;
    const fn_input = document.getElementById("filename-input") as HTMLInputElement;
    const select = document.getElementById('fformats') as HTMLSelectElement;
    const progress = document.getElementById("progress") as HTMLInputElement;

    if (!progress) {
      setIsWorking(false);
      return;
    }

    progress.value = "Please wait";
    if (fp_display && dp_display && fn_input && select) {
      var original_fp = fp_display.value;
      var target_dir = dp_display.value;
      var filename = fn_input.value;
      var filetype = select.value;

      if (original_fp && target_dir && filename && filetype){
        if (target_dir[target_dir.length - 1] != '/') target_dir += "/";
        var target_filepath = target_dir + filename + "." + filetype;
        try{
          var ret = await invoke("convert_filetype", {
            originalFilepath: original_fp, 
            destFilepath: target_filepath
          });
          if (ret == "Success") {
            progress.value = "Complete!";
          }
        }
        catch (error){
          progress.value = "Error occured, check console";
          console.log(error);
        }
        finally {
          setIsWorking(false);
          return;
        }
      }
      else {
        progress.value = "Please fill all fields";
        setIsWorking(false);
        return;
      }

    }
    else {
      progress.value = "Something went wrong";
      setIsWorking(false);
      return;
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
          convert_filetype()
        }}
      >
        <div className="internal-row">
          <button
          onClick={() => {
            select_file();
          }}
          type="button" className="share-btn" id="open-dialog-btn">Select File</button>
          <input type="text" className="share-btn" id="file-path-display" readOnly placeholder="No file selected..." />
        </div>
        <div className="internal-row">
          <label>Choose a new format: </label>
          <select name="fformats" id="fformats" defaultValue={"mp3"}>
            <option value="mp4">mp4</option>
            <option value="avi">avi</option>
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
          </select>
        </div>
        <div className="internal-row">
          <button
          onClick={() => {
            select_location();
          }}
          type="button" className="share-btn" id="open-dialog-btn">Select Save Location</button>
          <input type="text" className="share-btn" id="dir-path-display" readOnly placeholder="No folder selected..." />
        </div>
        <div className="internal-row">
          <label>Choose a filename</label>
          <input type="text" className="share-btn" id="filename-input"/>
        </div>
        <button type="submit" disabled={isWorking}>Convert</button>
        <div className="internal-row">
          <input type="text" className="share-btn" id="progress" readOnly />
        </div>
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

  const [isWorking, setIsWorking] = useState(false);

  // This helper function looks at the state and returns the correct component
  const renderContent = () => {
    switch (activeTab) {
      case "convert":
        return <ConvertPage isWorking={isWorking} setIsWorking={setIsWorking} />
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
        {/*
        <button 
          disabled={isWorking}
          onClick={() => setActiveTab("home")}
          className={activeTab === "home" ? "active" : ""}
        >
          Home
        </button>
        */}
        <button 
          disabled={isWorking}
          onClick={() => setActiveTab("convert")}
          className={activeTab === "convert" ? "active" : ""}
        >
          Convert
        </button>
        <button 
          disabled={isWorking}
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
