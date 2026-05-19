"use client";

import { useState, useEffect, useRef } from "react";

type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
};

type Filter = "all" | "active" | "completed";

function CheckIcon({ checked }: { checked: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`w-4 h-4 transition-all duration-200 ${checked ? "opacity-100" : "opacity-0 scale-75"}`}
    >
      <polyline
        points="2.5,8.5 6,12 13.5,4"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
      <path
        d="M6 4V3a1 1 0 011-1h6a1 1 0 011 1v1M3 4h14M5 4l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 8v5M12 8v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("todos");
    if (saved) {
      try {
        setTodos(JSON.parse(saved));
      } catch {
        setTodos([]);
      }
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("todos", JSON.stringify(todos));
    }
  }, [todos, mounted]);

  const addTodo = () => {
    const text = input.trim();
    if (!text) return;
    setTodos((prev) => [
      { id: crypto.randomUUID(), text, completed: false, createdAt: Date.now() },
      ...prev,
    ]);
    setInput("");
    inputRef.current?.focus();
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const clearCompleted = () => {
    setTodos((prev) => prev.filter((t) => !t.completed));
  };

  const filtered = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <main className="min-h-screen flex flex-col items-center justify-start pt-16 pb-24 px-4"
      style={{ background: "linear-gradient(135deg, #f8f7f4 0%, #ede8e0 100%)" }}
    >
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-light tracking-[0.2em] text-stone-800 mb-1">
          TODO
        </h1>
        <div className="w-8 h-0.5 bg-stone-400 mx-auto" />
      </div>

      {/* Card */}
      <div className="w-full max-w-md">
        {/* Input */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-100 p-4 mb-3 flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
            placeholder="新しいタスクを入力..."
            className="flex-1 text-sm text-stone-700 placeholder-stone-300 outline-none bg-transparent"
          />
          <button
            onClick={addTodo}
            disabled={!input.trim()}
            className="w-8 h-8 rounded-full bg-stone-800 text-white flex items-center justify-center flex-shrink-0
              hover:bg-stone-700 active:scale-95 transition-all duration-150
              disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
              <path d="M8 2v12M2 8h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Filter Tabs */}
        {todos.length > 0 && (
          <div className="flex gap-1 mb-3 bg-white rounded-xl shadow-sm border border-stone-100 p-1">
            {(["all", "active", "completed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
                  filter === f
                    ? "bg-stone-800 text-white"
                    : "text-stone-400 hover:text-stone-600"
                }`}
              >
                {f === "all" ? "すべて" : f === "active" ? "未完了" : "完了済み"}
              </button>
            ))}
          </div>
        )}

        {/* Todo List */}
        {mounted && (
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center py-12 text-stone-300 text-sm">
                {filter === "completed" ? "完了したタスクはありません" :
                 filter === "active" ? "未完了のタスクはありません" :
                 "タスクを追加してみましょう"}
              </div>
            )}
            {filtered.map((todo) => (
              <div
                key={todo.id}
                className="bg-white rounded-xl shadow-sm border border-stone-100 px-4 py-3.5 flex items-center gap-3
                  hover:border-stone-200 transition-colors duration-150 group"
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                    transition-all duration-200 ${
                    todo.completed
                      ? "bg-stone-800 border-stone-800"
                      : "border-stone-300 hover:border-stone-400"
                  }`}
                >
                  <CheckIcon checked={todo.completed} />
                </button>

                {/* Text */}
                <span
                  className={`flex-1 text-sm leading-relaxed transition-all duration-200 ${
                    todo.completed
                      ? "text-stone-300 line-through"
                      : "text-stone-700"
                  }`}
                >
                  {todo.text}
                </span>

                {/* Delete */}
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="text-stone-200 hover:text-red-400 transition-colors duration-150
                    opacity-0 group-hover:opacity-100 flex-shrink-0"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {todos.length > 0 && (
          <div className="mt-4 flex items-center justify-between px-1">
            <span className="text-xs text-stone-400">
              残り <span className="font-medium text-stone-600">{activeCount}</span> 件
            </span>
            {completedCount > 0 && (
              <button
                onClick={clearCompleted}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors duration-150"
              >
                完了済みを削除
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
