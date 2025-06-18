import React, { useState } from 'react'
import '../css/gamePage.css'

function GamePage() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <h2> Vite + React </h2>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </div>
  )
}

export default GamePage
