import { createContext, useContext, useState, ReactNode } from "react";
type Toast = { id: number; text: string };
const Ctx = createContext<{push:(t:string)=>void; list:Toast[]}>({push:()=>{}, list:[]});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  function push(text: string) {
    const id = Date.now();
    setList(prev => [...prev, { id, text }]);
    setTimeout(() => setList(prev => prev.filter(x => x.id !== id)), 2400);
  }
  return (
    <Ctx.Provider value={{ push, list }}>
      {children}
      <div className="fixed bottom-3 right-3 z-[9999] space-y-2">
        {list.map(t => (
          <div key={t.id} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm shadow">
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast(){ return useContext(Ctx); }