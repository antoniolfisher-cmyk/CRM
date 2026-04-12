import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

const WELCOME = {
  role: 'assistant',
  content: "Hi! I'm your SellerPulse support assistant. I can help you navigate the platform, troubleshoot issues, or explain any feature. What can I help you with today?",
}

export default function Support() {
  const [messages, setMessages] = useState([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    // Build messages array for API (exclude the initial welcome which is client-only)
    const apiMessages = nextMessages
      .filter((m, i) => !(i === 0 && m === WELCOME))
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const data = await api.supportChat(apiMessages)
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I ran into an error: ${err.message}. Please try again.`,
        error: true,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const reset = () => {
    setMessages([WELCOME])
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-violet-600">✦</span> Support
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">AI assistant — ask anything about the platform</p>
        </div>
        <button
          onClick={reset}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
        >
          New conversation
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <span className="text-violet-600 text-xs font-bold">✦</span>
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : msg.error
                  ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0 mr-2 mt-0.5">
              <span className="text-violet-600 text-xs font-bold">✦</span>
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts — only when just the welcome message */}
      {messages.length === 1 && (
        <div className="pb-3 flex flex-wrap gap-2 shrink-0">
          {[
            'How do I add a new product to source?',
            'How does the Aria repricer work?',
            'How do I check if I\'m ungated for a product?',
            'How does the Amazon inventory sync work?',
            'How do I track a follow-up?',
          ].map(prompt => (
            <button
              key={prompt}
              onClick={() => { setInput(prompt); inputRef.current?.focus() }}
              className="text-xs bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 pt-3 border-t border-gray-200">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="input flex-1 resize-none"
            rows={2}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="btn-primary px-4 self-end disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <SendIcon />
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          Powered by Claude · Responses are AI-generated and may not always be accurate
        </p>
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  )
}
