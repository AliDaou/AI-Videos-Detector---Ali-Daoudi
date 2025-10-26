import React, { useRef, useState, DragEvent, ChangeEvent } from 'react';
import { UploadCloudIcon } from './icons';

interface VideoUploaderProps {
  onFileSelect: (file: File | null) => void;
  onAnalyze: () => void;
  disabled: boolean;
}

const VideoUploader: React.FC<VideoUploaderProps> = ({ onFileSelect, onAnalyze, disabled }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setFileName(file.name);
      onFileSelect(file);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0] || null;
    if (file && file.type.startsWith('video/')) {
        setFileName(file.name);
        onFileSelect(file);
    } else {
        // Handle incorrect file type drop
        alert("Please drop a video file.");
    }
  };

  return (
    <div className="flex flex-col items-center space-y-6">
      <div 
        className={`w-full p-8 border-2 border-dashed rounded-lg text-center cursor-pointer transition-all duration-300 ${isDragging ? 'border-purple-400 bg-stone-800 shadow-lg shadow-purple-500/20' : 'border-stone-700 hover:border-purple-500 hover:bg-stone-800/50 hover:shadow-md hover:shadow-purple-500/10'}`}
        onClick={handleButtonClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="video/*"
        />
        <div className="flex flex-col items-center justify-center text-stone-400">
            <UploadCloudIcon className="w-12 h-12 mb-4 text-stone-500" />
            <p className="font-semibold text-stone-300">
            {fileName || 'Click to browse or drag & drop a video'}
            </p>
            <p className="text-sm">Supports MP4, WebM, Ogg, etc.</p>
        </div>
      </div>
      
      <button
        onClick={onAnalyze}
        disabled={disabled}
        className="w-full sm:w-auto px-12 py-3 text-lg font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 rounded-lg shadow-lg hover:from-purple-700 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 focus:ring-offset-stone-900 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
      >
        Analyze Video
      </button>
    </div>
  );
};

export default VideoUploader;