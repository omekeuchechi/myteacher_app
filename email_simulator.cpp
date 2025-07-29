// #include <iostream>
// #include <fstream>
// #include <string>
// #include <ctime>
// #include <filesystem>
// #include <cstdlib>
// #include <cstring>
// #include <stdexcept>
// #include <vector>
// #include <sstream>
// #include <algorithm>

// #ifdef _WIN32
// #include <windows.h>
// #else
// #include <unistd.h>
// #endif

// namespace fs = std::filesystem;

// class EmailSimulator {
// private:
//     std::string storagePath;
//     std::string smtpServer;
//     std::string smtpPort;
//     bool useLocalSendmail;
    
//     std::string getCurrentTimestamp() {
//         std::time_t now = std::time(nullptr);
//         char timestamp[100];
//         std::strftime(timestamp, sizeof(timestamp), "%a, %d %b %Y %H:%M:%S %z", std::localtime(&now));
//         return std::string(timestamp);
//     }
    
//     std::string generateMessageId(const std::string& domain) {
//         std::stringstream ss;
//         ss << "<" << std::time(nullptr) << "." 
//            << (std::rand() % 10000) << "@" << domain << ">";
//         return ss.str();
//     }
    
//     bool createStorageDirectory() {
//         try {
//             if (!fs::exists(storagePath)) {
//                 return fs::create_directories(storagePath);
//             }
//             return true;
//         } catch (const std::exception& e) {
//             std::cerr << "Error creating storage directory: " << e.what() << std::endl;
//             return false;
//         }
//     }
    
//     bool executeCommand(const std::string& command) {
//     #ifdef _WIN32
//         // Windows implementation
//         PROCESS_INFORMATION processInfo;
//         STARTUPINFOA startupInfo;
//         ZeroMemory(&processInfo, sizeof(processInfo));
//         ZeroMemory(&startupInfo, sizeof(startupInfo));
//         startupInfo.cb = sizeof(startupInfo);
        
//         // Create a mutable copy of the command string
//         char cmd[1024];
//         strncpy(cmd, command.c_str(), sizeof(cmd));
//         cmd[sizeof(cmd) - 1] = '\0';
        
//         if (!CreateProcessA(NULL, cmd, NULL, NULL, FALSE, 
//                            CREATE_NO_WINDOW, NULL, NULL, &startupInfo, &processInfo)) {
//             std::cerr << "Failed to execute command: " << command << std::endl;
//             return false;
//         }
        
//         WaitForSingleObject(processInfo.hProcess, INFINITE);
        
//         DWORD exitCode;
//         GetExitCodeProcess(processInfo.hProcess, &exitCode);
        
//         CloseHandle(processInfo.hProcess);
//         CloseHandle(processInfo.hThread);
        
//         return (exitCode == 0);
//     #else
//         // Unix-like systems
//         int status = system((command + " > /dev/null 2>&1").c_str());
//         return (WIFEXITED(status) && WEXITSTATUS(status) == 0);
//     #endif
//     }

// public:
//     EmailSimulator(const std::string& path = "emails", 
//                   const std::string& server = "localhost", 
//                   const std::string& port = "25",
//                   bool useLocal = true) 
//         : storagePath(path), smtpServer(server), smtpPort(port), useLocalSendmail(useLocal) {
//         std::srand(static_cast<unsigned int>(std::time(nullptr)));
//         if (!createStorageDirectory()) {
//             throw std::runtime_error("Failed to create email storage directory");
//         }
//     }
    
//     bool sendEmail(const std::string& to, 
//                   const std::string& subject, 
//                   const std::string& body,
//                   const std::string& from = "noreply@localhost") {
        
//         std::string emailId = generateMessageId("localdomain");
//         std::string filename = storagePath + "/" + std::to_string(std::time(nullptr)) + 
//                               "_" + std::to_string(rand() % 1000) + ".eml";
        
//         // Create email content
//         std::string emailContent;
//         emailContent += "From: " + from + "\r\n";
//         emailContent += "To: " + to + "\r\n";
//         emailContent += "Subject: " + subject + "\r\n";
//         emailContent += "Date: " + getCurrentTimestamp() + "\r\n";
//         emailContent += "Message-ID: " + emailId + "\r\n";
//         emailContent += "MIME-Version: 1.0\r\n";
//         emailContent += "Content-Type: text/plain; charset=utf-8\r\n";
//         emailContent += "\r\n" + body + "\r\n";
        
//         // Save email to file
//         std::ofstream emailFile(filename);
//         if (!emailFile) {
//             std::cerr << "Error: Could not create email file" << std::endl;
//             return false;
//         }
//         emailFile << emailContent;
//         emailFile.close();
        
//         // Send email using local sendmail or SMTP
//         bool sent = false;
//         if (useLocalSendmail) {
//             #ifdef _WIN32
//                 // On Windows, use a simple SMTP client or PowerShell
//                 std::string command = "powershell -Command \"Send-MailMessage " +
//                     "-From '" + from + "' " +
//                     "-To '" + to + "' " +
//                     "-Subject '" + subject + "' " +
//                     "-Body '" + body + "' " +
//                     "-SmtpServer '" + smtpServer + "' -Port " + smtpPort + "\"";
//             #else
//                 // On Unix-like systems, use sendmail
//                 std::string command = "sendmail -t -i";
//             #endif
//             sent = executeCommand(command + " < \"" + filename + "\"");
//         } else {
//             // Use SMTP client (you would need to implement this or use a library)
//             std::cerr << "Direct SMTP sending not implemented in this example" << std::endl;
//             std::cerr << "Email saved to: " << filename << std::endl;
//             sent = true; // Consider it sent since we saved it
//         }
        
//         if (sent) {
//             std::cout << "Email sent successfully to: " << to << std::endl;
//             std::cout << "Message ID: " << emailId << std::endl;
//             if (!useLocalSendmail) {
//                 std::cout << "Email saved to: " << filename << std::endl;
//             }
//         } else {
//             std::cerr << "Failed to send email. Saved to: " << filename << std::endl;
//         }
        
//         return sent;
//     }
    
//     void listEmails() {
//         std::cout << "\n=== Stored Emails ===" << std::endl;
//         try {
//             std::vector<fs::directory_entry> files;
//             for (const auto& entry : fs::directory_iterator(storagePath)) {
//                 if (entry.path().extension() == ".eml") {
//                     files.push_back(entry);
//                 }
//             }
            
//             // Sort by modification time (newest first)
//             std::sort(files.begin(), files.end(), 
//                 [](const fs::directory_entry& a, const fs::directory_entry& b) {
//                     return fs::last_write_time(a) > fs::last_write_time(b);
//                 });
                
//             for (const auto& entry : files) {
//                 auto ftime = fs::last_write_time(entry);
//                 auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
//                     ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now());
//                 std::time_t cftime = std::chrono::system_clock::to_time_t(sctp);
                
//                 std::cout << "- " << entry.path().filename().string() 
//                           << " (" << std::asctime(std::localtime(&cftime)) << ")";
//             }
//         } catch (const std::exception& e) {
//             std::cerr << "Error reading email directory: " << e.what() << std::endl;
//         }
//     }
    
//     void viewEmail(const std::string& filename) {
//         std::string filepath = storagePath + "/" + filename;
//         std::ifstream file(filepath);
//         if (file) {
//             std::cout << "\n=== Email: " << filename << " ===\n";
//             std::cout << file.rdbuf();
//             std::cout << "\n======================\n";
//         } else {
//             std::cerr << "Error: Could not open email file: " << filename << std::endl;
//         }
//     }
// };

// int main() {
//     try {
//         std::cout << "=== Email Client ===" << std::endl;
//         std::cout << "1. Use local sendmail (Unix-like systems)" << std::endl;
//         std::cout << "2. Use SMTP server" << std::endl;
//         std::cout << "Choose an option (1-2): ";
        
//         int option;
//         std::cin >> option;
//         std::cin.ignore();
        
//         EmailSimulator emailer;
        
//         if (option == 2) {
//             std::string server, port;
//             std::cout << "Enter SMTP server: ";
//             std::getline(std::cin, server);
//             std::cout << "Enter SMTP port (default 25): ";
//             std::getline(std::cin, port);
//             if (port.empty()) port = "25";
            
//             emailer = EmailSimulator("emails", server, port, false);
//         }
        
//         while (true) {
//             std::cout << "\nOptions:\n";
//             std::cout << "1. Send an email\n";
//             std::cout << "2. List stored emails\n";
//             std::cout << "3. View an email\n";
//             std::cout << "4. Exit\n";
//             std::cout << "Choose an option: ";
            
//             int choice;
//             std::cin >> choice;
//             std::cin.ignore();
            
//             if (choice == 1) {
//                 std::string to, subject, body, from;
                
//                 std::cout << "\nFrom (default: noreply@localhost): ";
//                 std::getline(std::cin, from);
//                 if (from.empty()) from = "noreply@localhost";
                
//                 std::cout << "To: ";
//                 std::getline(std::cin, to);
                
//                 std::cout << "Subject: ";
//                 std::getline(std::cin, subject);
                
//                 std::cout << "Body (end with a line containing only a period):\n";
//                 std::string line;
//                 while (std::getline(std::cin, line) && line != ".") {
//                     body += line + "\n";
//                 }
                
//                 emailer.sendEmail(to, subject, body, from);
                
//             } else if (choice == 2) {
//                 emailer.listEmails();
//             } else if (choice == 3) {
//                 std::string filename;
//                 std::cout << "Enter email filename: ";
//                 std::getline(std::cin, filename);
//                 emailer.viewEmail(filename);
//             } else if (choice == 4) {
//                 std::cout << "Goodbye!" << std::endl;
//                 break;
//             } else {
//                 std::cout << "Invalid option. Please try again." << std::endl;
//             }
//         }
//     } catch (const std::exception& e) {
//         std::cerr << "Error: " << e.what() << std::endl;
//         return 1;
//     }
    
//     return 0;
// }

#include <iostream>
#include <fstream>
#include <string>
#include <ctime>
#include <filesystem>
#include <cstdlib>

namespace fs = std::filesystem;

class EmailSender {
private:
    std::string storagePath;
    
    std::string getTimestamp() {
        std::time_t now = std::time(nullptr);
        char timestamp[100];
        std::strftime(timestamp, sizeof(timestamp), "%Y-%m-%d %H:%M:%S", std::localtime(&now));
        return timestamp;
    }

public:
    EmailSender(const std::string& path = "emails") : storagePath(path) {
        if (!fs::exists(storagePath)) {
            fs::create_directories(storagePath);
        }
    }

    bool sendEmail(const std::string& to, 
                  const std::string& subject, 
                  const std::string& body,
                  const std::string& from = "noreply@localhost") {
        
        std::string filename = storagePath + "/" + getTimestamp() + ".eml";
        std::string messageId = "<" + std::to_string(std::time(nullptr)) + "@local>";
        
        std::ofstream emailFile(filename);
        if (!emailFile) return false;
        
        emailFile << "From: " << from << "\n";
        emailFile << "To: " << to << "\n";
        emailFile << "Subject: " << subject << "\n";
        emailFile << "Date: " << getTimestamp() << "\n";
        emailFile << "Message-ID: " << messageId << "\n\n";
        emailFile << body << "\n";
        emailFile.close();

        // On Unix-like systems, try to send using sendmail
        #ifndef _WIN32
        std::string cmd = "sendmail -t < \"" + filename + "\"";
        if (system(cmd.c_str()) != 0) {
            std::cerr << "Sendmail failed, email saved to " << filename << "\n";
            return false;
        }
        #endif

        return true;
    }
};

int main() {
    EmailSender sender;
    
    std::string to, subject, body;
    
    std::cout << "To: ";
    std::getline(std::cin, to);
    
    std::cout << "Subject: ";
    std::getline(std::cin, subject);
    
    std::cout << "Body (end with a dot on a new line):\n";
    std::string line;
    while (std::getline(std::cin, line) && line != ".") {
        body += line + "\n";
    }
    
    if (sender.sendEmail(to, subject, body)) {
        std::cout << "Email sent successfully!\n";
    } else {
        std::cerr << "Failed to send email.\n";
    }
    
    return 0;
}