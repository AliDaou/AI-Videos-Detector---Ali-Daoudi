import React, { useState, useEffect } from 'react';

const loadingMessages = [
    "Extracting keyframes from video...",
    "Scanning for temporal inconsistencies...",
    "Checking for morphing artifacts...",
    "Analyzing light and shadow physics...",
    "Consulting our digital forensics expert...",
];

const Loader: React.FC = () => {
    const [messageIndex, setMessageIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setMessageIndex((prevIndex) => (prevIndex + 1) % loadingMessages.length);
        }, 2500); // Change message every 2.5 seconds

        return () => clearInterval(interval);
    }, []);

  return (
    <div className="flex flex-col items-center justify-center space-y-4 py-12">
      <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-purple-400"></div>
      <h2 className="text-xl font-semibold text-stone-300">Analyzing Video...</h2>
      <p className="text-stone-400 text-center max-w-sm transition-opacity duration-500">
        {loadingMessages[messageIndex]}
      </p>
    </div>
  );
};

export default Loader;