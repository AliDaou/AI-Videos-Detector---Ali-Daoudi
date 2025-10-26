import React, { useState, useCallback } from 'react';
import { AnalysisResult, AppState } from './types';
import { analyzeVideoFrames } from './services/geminiService';
import VideoUploader from './components/VideoUploader';
import ResultsDisplay from './components/ResultsDisplay';
import Loader from './components/Loader';
import { ShieldExclamationIcon } from './components/icons';
import FloatingElements from './components/FloatingElements';

// Helper function to extract frames from a video file
const extractFramesFromVideo = async (file: File, frameCount: number): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: string[] = [];

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const duration = video.duration;
      if (duration === 0) {
        reject(new Error("Video has no duration."));
        return;
      }

      const interval = duration / (frameCount + 1);
      let capturedFrames = 0;

      const captureFrame = (time: number) => {
        video.currentTime = time;
      };

      video.onseeked = () => {
        if (ctx) {
          ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
          // Get base64 string without 'data:image/jpeg;base64,' prefix
          const base64 = canvas.toDataURL('image/jpeg').split(',')[1];
          frames.push(base64);
          capturedFrames++;

          if (capturedFrames === frameCount) {
             URL.revokeObjectURL(video.src); // Clean up
            resolve(frames);
          } else {
            captureFrame(interval * (capturedFrames + 1));
          }
        }
      };
       video.onerror = (e) => {
         URL.revokeObjectURL(video.src); // Clean up
         reject(new Error('Failed to load or play the video.'));
       };
      
      // Start capturing the first frame
      captureFrame(interval);
    };
  });
};


const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const handleAnalysis = useCallback(async () => {
    if (!videoFile) {
      setError('Please select a video file first.');
      return;
    }

    setAppState('loading');
    setError(null);
    setAnalysisResult(null);

    try {
      // Extract 5 frames for analysis
      const frames = await extractFramesFromVideo(videoFile, 5);
      if (frames.length === 0) {
        throw new Error("Could not extract any frames from the video. The file might be corrupted or in an unsupported format.");
      }
      
      const result = await analyzeVideoFrames(frames);
      setAnalysisResult(result);
      setAppState('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during analysis.';
      console.error(errorMessage);
      setError(errorMessage);
      setAppState('error');
    }
  }, [videoFile]);
  
  const handleFileSelect = (file: File | null) => {
    setVideoFile(file);
    setAnalysisResult(null);
    setError(null);
    setAppState('idle');
  };

  const resetState = () => {
    setVideoFile(null);
    setAnalysisResult(null);
    setError(null);
    setAppState('idle');
  };


  return (
    <div className="min-h-screen bg-transparent text-stone-200 flex flex-col items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden">
      <FloatingElements />
      <div className="w-full max-w-2xl mx-auto z-10">
        <header className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400 mb-2">
            AI Video Detector
            </h1>
            <p className="text-stone-400 text-lg">
            Upload a video to analyze it for signs of AI generation.
            </p>
        </header>

        <main className="bg-stone-900/70 p-6 sm:p-8 rounded-2xl shadow-2xl shadow-purple-900/20 border border-stone-800 backdrop-blur-lg">
            {appState === 'loading' ? (
              <Loader />
            ) : analysisResult ? (
              <ResultsDisplay result={analysisResult} onReset={resetState} />
            ) : (
                <VideoUploader onFileSelect={handleFileSelect} onAnalyze={handleAnalysis} disabled={!videoFile}/>
            )}

            {error && (
            <div className="mt-6 p-4 bg-red-900/50 border border-red-700 text-red-300 rounded-lg flex items-start space-x-3">
                <ShieldExclamationIcon className="h-6 w-6 flex-shrink-0 text-red-400" />
                <div>
                <h3 className="font-semibold">Analysis Failed</h3>
                <p className="text-sm">{error}</p>
                </div>
            </div>
            )}
        </main>

        <footer className="text-center mt-8 text-stone-500 text-sm">
            <p>&copy; {new Date().getFullYear()} AI Video Detector.</p>
            <p>Made by Ali Daoudi.</p>
        </footer>
      </div>
    </div>
  );
};

export default App;