import React, { useRef, useEffect } from 'react';
import { ShieldCheckIcon, UploadCloudIcon, EyeIcon, VerifiedIcon, CpuChipIcon } from './icons';

const elementsConfig = [
  { id: 1, size: '80px', top: '15%', left: '10%', animation: 'float1 15s infinite ease-in-out', Icon: CpuChipIcon, colorClass: 'glow-purple', bgColor: 'rgba(168, 85, 247, 0.08)' },
  { id: 2, size: '50px', top: '25%', left: '80%', animation: 'float2 12s infinite ease-in-out', Icon: ShieldCheckIcon, colorClass: 'glow-cyan', bgColor: 'rgba(56, 189, 248, 0.1)' },
  { id: 3, size: '100px', top: '70%', left: '5%', animation: 'float3 18s infinite ease-in-out', Icon: EyeIcon, colorClass: 'glow-purple', bgColor: 'rgba(168, 85, 247, 0.05)' },
  { id: 4, size: '40px', top: '85%', left: '40%', animation: 'float4 10s infinite ease-in-out', Icon: VerifiedIcon, colorClass: 'glow-cyan', bgColor: 'rgba(56, 189, 248, 0.1)' },
  { id: 5, size: '120px', top: '5%', left: '45%', animation: 'float2 22s infinite ease-in-out', Icon: CpuChipIcon, colorClass: 'glow-purple', bgColor: 'rgba(168, 85, 247, 0.08)' },
  { id: 6, size: '60px', top: '75%', left: '90%', animation: 'float3 16s infinite ease-in-out', Icon: UploadCloudIcon, colorClass: 'glow-cyan', bgColor: 'rgba(56, 189, 248, 0.12)' },
  { id: 7, size: '70px', top: '50%', left: '50%', animation: 'float1 13s infinite ease-in-out', Icon: EyeIcon, colorClass: 'glow-cyan', bgColor: 'rgba(56, 189, 248, 0.09)' },
  { id: 8, size: '90px', top: '90%', left: '15%', animation: 'float4 19s infinite ease-in-out', Icon: ShieldCheckIcon, colorClass: 'glow-purple', bgColor: 'rgba(168, 85, 247, 0.1)' },
];

const FloatingElements: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const repelRadius = 150;
    const repelStrength = 60;

    const handleMouseMove = (e: MouseEvent) => {
      if (!elementRefs.current) return;
      
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      elementRefs.current.forEach(el => {
        if (!el) return;

        const { left, top, width, height } = el.getBoundingClientRect();
        const elCenterX = left + width / 2;
        const elCenterY = top + height / 2;

        const dx = elCenterX - mouseX;
        const dy = elCenterY - mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < repelRadius) {
          const force = (repelRadius - distance) / repelRadius;
          const pushX = (dx / distance) * force * repelStrength;
          const pushY = (dy / distance) * force * repelStrength;
          el.style.transform = `translate(${pushX}px, ${pushY}px)`;
        } else {
          el.style.transform = 'translate(0, 0)';
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full z-0 overflow-hidden" aria-hidden="true">
      {elementsConfig.map((el, i) => (
        <div
          key={el.id}
          ref={ref => (elementRefs.current[i] = ref)}
          className={`float-shape ${el.colorClass}`}
          style={{
            width: el.size,
            height: el.size,
            top: el.top,
            left: el.left,
            animation: el.animation,
            backgroundColor: el.bgColor,
          }}
        >
          {el.Icon && <el.Icon className="w-1/2 h-1/2 text-stone-200/20" />}
        </div>
      ))}
    </div>
  );
};

export default FloatingElements;