// const btn = document.querySelector("#btn");
// const content = document.querySelector(".content");


// i am working on the voice side
const speak = (text) =>{
    const text_speak = new SpeechSynthesisUtterance(text);
    text_speak.rate = 1;
    text_speak.volume = 1;
    text_speak.pitch = 1;
    // text_speak.voice = 2;

    window.speechSynthesis.speak(text_speak);
}

module.exports = {  
    speak 
}; 

// init

// window.addEventListener("load", ()=>{
//     speak("initializing buy-bit Assistant");
//     speak("i am under development");
// });

// const speechRecognition = window.speechRecognition || window.webkitSpeechRecognition;

// const recognition = new speechRecognition();


// recognition.onresult = (event) => {
//     const currentIndex = event.resultIndex;
//     const transcript = event.results[currentIndex][0].transcript;
//     content.textContent = transcript;

//     takeCommand(transcript.toLowerCase());
// }

// btn.addEventListener('click', ()=> {
//     content.textContent = "Listening......";
//     recognition.start();
// });

// let dummyReply = "make it more understanding";

// function takeCommand(message) {
//     if (message.includes('hey') || message.includes('hello')) {
//         speak("hello boss, how can i be of help to you today please state your problem")
//     }
//     else if ( message.includes('what') || message.includes('find')){
//         speak("i am here to assist you with finding information")
//     }
//     else if (message.includes('where') || message.includes('locate')){
//         speak("i am here to assist you with finding location")
//     }
//     else if (message.includes('how') || message.includes('do')){
//         speak("i am here to assist you with answering questions")
//     }
//     else if (message.includes('search') || message.includes('google')) {
//         const searchQuery = message.replace('search', '').replace('google', '').trim();
//         const url = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
//         window.open(url, '_blank');
//         speak("opening". url);
//     }
//     else if (message.includes('play') || message.includes('music')) {
//         const song = message.replace('play', '').replace('music', '').trim();
//         const musicUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(song)}`;
//         window.open(musicUrl, '_blank');
//         speak("playing". song);
//     }
//     else if (message.includes('time') || message.includes('date')) {
//         const today = new Date();
//         const date = today.getDate() + '-' + (today.getMonth() + 1) + '-' + today.getFullYear();
//         const time = today.getHours() + ':' + today.getMinutes();
//         speak(`today's date is ${date} and time is ${time}`);
//     }
//     else if (message.includes('bye') || message.includes('goodbye')) {
//         speak("goodbye boss, have a nice day")
//         recognition.stop();
//     }
//      else {
//         speak(dummyReply);
//     }
// }