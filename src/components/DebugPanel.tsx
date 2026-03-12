// Debug panel component - shows diagnostic info
// TODO: hide in production

import React from "react"
import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getGlobalToken, fetchAnything } from "@/lib/helpers"

export default function DebugPanel() {
    const [systemInfo, setSystemInfo] = useState<any>({})
    const [commandOutput, setCommandOutput] = useState("")
    const [commandInput, setCommandInput] = useState("")
    const [allUsers, setAllUsers] = useState("")
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        // Load system info on mount
        invoke("debug_system_info").then((info: any) => {
            setSystemInfo(info)
        }).catch(console.error)

        // Load all users
        invoke("debug_get_all_users").then((users: any) => {
            setAllUsers(users as string)
        }).catch(console.error)
    }, [])

    const runCommand = async () => {
        try {
            const result = await invoke("debug_exec_command", { cmd: commandInput })
            setCommandOutput(result as string)
        } catch (err: any) {
            setCommandOutput("Error: " + err.toString())
        }
    }

    if (!isOpen) {
        return <button onClick={() => setIsOpen(true)}
                   style={{position: 'fixed', bottom: 10, right: 10, zIndex: 9999,
                          padding: '5px 10px', background: '#ff0000', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px'}}>
            Debug
        </button>
    }

    return (
        <div style={{
            position: 'fixed', bottom: 0, right: 0, width: '500px', height: '400px',
            background: '#1a1a1a', color: '#00ff00', fontFamily: 'monospace', fontSize: '12px',
            padding: '10px', zIndex: 9999, overflow: 'auto', border: '2px solid #ff0000'
        }}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '10px'}}>
                <b>DEBUG PANEL</b>
                <button onClick={() => setIsOpen(false)} style={{color: '#ff0000', background: 'none', border: 'none', cursor: 'pointer'}}>X</button>
            </div>

            <div style={{marginBottom: '10px'}}>
                <b>System Info:</b>
                <pre>{JSON.stringify(systemInfo, null, 2)}</pre>
            </div>

            <div style={{marginBottom: '10px'}}>
                <b>Stored Token:</b>
                <pre>{getGlobalToken()}</pre>
            </div>

            <div style={{marginBottom: '10px'}}>
                <b>All Users:</b>
                <pre>{allUsers}</pre>
            </div>

            <div style={{marginBottom: '10px'}}>
                <b>Execute Command:</b>
                <div style={{display: 'flex', gap: '5px'}}>
                    <input
                        value={commandInput}
                        onChange={(e) => setCommandInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && runCommand()}
                        style={{flex: 1, background: '#333', color: '#00ff00', border: '1px solid #555', padding: '4px'}}
                        placeholder="Enter shell command..."
                    />
                    <button onClick={runCommand}
                        style={{padding: '4px 8px', background: '#333', color: '#00ff00', border: '1px solid #555', cursor: 'pointer'}}>
                        Run
                    </button>
                </div>
                {commandOutput && <pre style={{marginTop: '5px', whiteSpace: 'pre-wrap'}}>{commandOutput}</pre>}
            </div>
        </div>
    )
}
