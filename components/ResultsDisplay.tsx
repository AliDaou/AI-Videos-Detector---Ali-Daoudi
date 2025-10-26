import React, { useState } from 'react';
import { AnalysisResult } from '../types';
import { ShieldCheckIcon, ShieldExclamationIcon, RefreshCwIcon, Share2Icon } from './icons';

interface ResultsDisplayProps {
  result: AnalysisResult;
  onReset: () => void;
}

const ConfidenceBar: React.FC<{ score: number }> = ({ score }) => {
    const width = `${score * 100}%`;
    const isHighConfidence = score > 0.75;
    const isMediumConfidence = score > 0.4 && score <= 0.75;
    
    const barColor = isHighConfidence ? 'bg-red-500' : isMediumConfidence ? 'bg-yellow-500' : 'bg-green-500';

    return (
        <div className="w-full bg-stone-700 rounded-full h-4 my-2">
            <div
                className={`${barColor} h-4 rounded-full transition-all duration-1000 ease-out`}
                style={{ width }}
            ></div>
        </div>
    );
};


const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ result, onReset }) => {
  const { is_ai_generated, confidence_score, reasoning, artifacts_detected } = result;
  const [isCopied, setIsCopied] = useState(false);

  const resultTitle = is_ai_generated ? "AI-Generated Content Detected" : "Likely Authentic Content";
  const ResultIcon = is_ai_generated ? ShieldExclamationIcon : ShieldCheckIcon;
  const iconColor = is_ai_generated ? "text-red-400" : "text-green-400";
  const textColor = is_ai_generated ? "text-red-300" : "text-green-300";

  const handleShare = async () => {
    const shareData = {
        title: 'AI Video Detector',
        text: 'Check out this tool that analyzes videos for signs of AI generation!',
        url: window.location.href,
    };
    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // Fallback for browsers that do not support the Web Share API
            await navigator.clipboard.writeText(shareData.url);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
        }
    } catch (error) {
        console.error('Error sharing:', error);
        // Fallback for failed share attempts
        await navigator.clipboard.writeText(shareData.url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }
  };


  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center animate-fade-in-up opacity-0">
        <ResultIcon className={`w-16 h-16 mx-auto mb-4 ${iconColor}`} />
        <h2 className={`text-2xl sm:text-3xl font-bold ${textColor}`}>{resultTitle}</h2>
      </div>

      <div className="animate-fade-in-up opacity-0 stagger-1">
        <h3 className="text-lg font-semibold text-stone-300">Confidence Score</h3>
        <p className="text-2xl font-bold text-stone-100">{(confidence_score * 100).toFixed(1)}%</p>
        <ConfidenceBar score={confidence_score}/>
      </div>

      <div className="animate-fade-in-up opacity-0 stagger-2">
        <h3 className="text-lg font-semibold text-stone-300">Analyst's Reasoning</h3>
        <p className="text-stone-400 bg-stone-800/50 p-4 rounded-lg border border-stone-700 mt-2">
            {reasoning}
        </p>
      </div>
      
      {artifacts_detected && artifacts_detected.length > 0 && (
        <div className="animate-fade-in-up opacity-0 stagger-3">
            <h3 className="text-lg font-semibold text-stone-300 mb-2">Key Artifacts Detected</h3>
            <div className="flex flex-wrap gap-2">
                {artifacts_detected.map((artifact, index) => (
                    <span key={index} className="bg-purple-900/50 text-purple-300 text-sm font-medium px-3 py-1 rounded-full border border-purple-800">
                        {artifact}
                    </span>
                ))}
            </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 animate-fade-in-up opacity-0 stagger-4">
        <button
            onClick={onReset}
            className="w-full sm:w-auto px-6 py-2 font-semibold text-stone-300 bg-stone-700 rounded-lg hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-500 focus:ring-offset-stone-900 transition-colors duration-300 flex items-center justify-center space-x-2"
        >
            <RefreshCwIcon className="w-5 h-5"/>
            <span>Analyze Another</span>
        </button>
        <button
            onClick={handleShare}
            className="w-full sm:w-auto px-6 py-2 font-semibold text-stone-300 bg-cyan-800/50 rounded-lg hover:bg-cyan-700/60 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-stone-900 transition-colors duration-300 flex items-center justify-center space-x-2"
        >
            <Share2Icon className="w-5 h-5"/>
            <span>{isCopied ? 'Link Copied!' : 'Share App'}</span>
        </button>
      </div>
    </div>
  );
};

export default ResultsDisplay;