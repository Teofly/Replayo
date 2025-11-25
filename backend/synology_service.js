const axios = require('axios');
const https = require('https');

// Create axios instance that ignores SSL certificate errors (for self-signed certs)
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

class SynologyService {
  constructor(host, port, username, password) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.sid = null;
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Test connection and login to Synology DSM
   */
  async testConnection() {
    try {
      await this.login();
      const info = await this.getAPIInfo();
      await this.logout();

      return {
        success: true,
        message: 'Connessione riuscita',
        info
      };
    } catch (error) {
      throw new Error(`Connessione fallita: ${error.message}`);
    }
  }

  /**
   * Login to Synology Surveillance Station
   */
  async login() {
    try {
      const response = await axiosInstance.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api: 'SYNO.API.Auth',
          version: '3',
          method: 'login',
          account: this.username,
          passwd: this.password,
          session: 'SurveillanceStation',
          format: 'sid'
        }
      });

      if (response.data && response.data.success) {
        this.sid = response.data.data.sid;
        return this.sid;
      } else {
        throw new Error(response.data.error?.code || 'Login failed');
      }
    } catch (error) {
      throw new Error(`Login error: ${error.message}`);
    }
  }

  /**
   * Logout from Synology
   */
  async logout() {
    if (!this.sid) return;

    try {
      await axiosInstance.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api: 'SYNO.API.Auth',
          version: '3',
          method: 'logout',
          session: 'SurveillanceStation',
          _sid: this.sid
        }
      });
      this.sid = null;
    } catch (error) {
      console.error('Logout error:', error.message);
    }
  }

  /**
   * Get API info
   */
  async getAPIInfo() {
    try {
      const response = await axiosInstance.get(`${this.baseUrl}/webapi/query.cgi`, {
        params: {
          api: 'SYNO.API.Info',
          version: '1',
          method: 'query',
          query: 'SYNO.SurveillanceStation.*'
        }
      });

      return response.data;
    } catch (error) {
      throw new Error(`API Info error: ${error.message}`);
    }
  }

  /**
   * Get list of cameras
   */
  async getCameraList() {
    if (!this.sid) await this.login();

    try {
      const response = await axiosInstance.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.SurveillanceStation.Camera',
          version: '9',
          method: 'List',
          _sid: this.sid
        }
      });

      if (response.data && response.data.success) {
        return response.data.data.cameras;
      } else {
        throw new Error('Failed to get camera list');
      }
    } catch (error) {
      throw new Error(`Camera list error: ${error.message}`);
    }
  }

  /**
   * Download recording by event ID
   * @param {number} eventId - Event/Recording ID
   */
  async getRecordingUrlByEventId(eventId) {
    if (!this.sid) await this.login();

    try {
      // Build download URL using eventId
      const downloadUrl = `${this.baseUrl}/webapi/entry.cgi?` +
        `api=SYNO.SurveillanceStation.Recording&` +
        `version=5&` +
        `method=Download&` +
        `eventId=${eventId}&` +
        `_sid=${this.sid}`;

      return {
        url: downloadUrl,
        sid: this.sid
      };
    } catch (error) {
      throw new Error(`Recording URL error: ${error.message}`);
    }
  }

  /**
   * Download recording from Surveillance Station
   * @param {number} cameraId - Camera ID
   * @param {string} startTime - Start time in ISO format or timestamp
   * @param {string} endTime - End time in ISO format or timestamp
   */
  async getRecordingUrl(cameraId, startTime, endTime) {
    if (!this.sid) await this.login();

    try {
      // Convert ISO datetime to Unix timestamp (seconds)
      const startTimestamp = Math.floor(new Date(startTime).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000);

      // Build download URL for recording
      const downloadUrl = `${this.baseUrl}/webapi/entry.cgi?` +
        `api=SYNO.SurveillanceStation.Recording&` +
        `version=5&` +
        `method=Download&` +
        `cameraIds=${cameraId}&` +
        `fromTime=${startTimestamp}&` +
        `toTime=${endTimestamp}&` +
        `_sid=${this.sid}`;

      return {
        url: downloadUrl,
        sid: this.sid
      };
    } catch (error) {
      throw new Error(`Recording URL error: ${error.message}`);
    }
  }

  /**
   * List recordings for a camera in a time range
   */
  async listRecordings(cameraId, startTime, endTime) {
    if (!this.sid) await this.login();

    try {
      const startTimestamp = Math.floor(new Date(startTime).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(endTime).getTime() / 1000);

      console.log(`[Synology] Listing recordings for camera ${cameraId}`);
      console.log(`[Synology] Time range: ${new Date(startTimestamp * 1000).toISOString()} -> ${new Date(endTimestamp * 1000).toISOString()}`);

      const response = await axiosInstance.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.SurveillanceStation.Recording',
          version: '5',
          method: 'List',
          cameraIds: cameraId,
          fromTime: startTimestamp,
          toTime: endTimestamp,
          _sid: this.sid
        }
      });

      console.log(`[Synology] Response:`, JSON.stringify(response.data, null, 2));

      if (response.data && response.data.success) {
        const recordings = response.data.data?.events || response.data.data?.recordings || [];
        console.log(`[Synology] Found ${recordings.length} recordings`);
        return recordings;
      } else {
        throw new Error(`Failed to list recordings: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.error(`[Synology] List recordings error:`, error);
      throw new Error(`List recordings error: ${error.message}`);
    }
  }

  /**
   * Get recording file info by finding recordings in time range
   */
  async getRecordingFileInfo(cameraId, startTime, endTime) {
    const recordings = await this.listRecordings(cameraId, startTime, endTime);

    if (!recordings || recordings.length === 0) {
      throw new Error('No recordings found for the specified time range');
    }

    // Return the first recording that overlaps with the requested time
    // In the future we could merge multiple recordings or select the best one
    return recordings[0];
  }

  /**
   * Download recording stream (kept for compatibility but recommends using file path)
   */
  async downloadRecording(cameraId, startTime, endTime) {
    // Don't use the Download API - it doesn't work reliably
    // Instead, return the file path for direct filesystem access
    const recordingInfo = await this.getRecordingFileInfo(cameraId, startTime, endTime);

    if (!recordingInfo || !recordingInfo.folder || !recordingInfo.path) {
      throw new Error('Recording file path not found');
    }

    // Return info for direct file access
    return {
      filePath: `${recordingInfo.folder}/${recordingInfo.path}`,
      fileName: recordingInfo.name || recordingInfo.path,
      recordingInfo: recordingInfo
    };
  }

  /**
   * Login to File Station (different session from Surveillance Station)
   */
  async loginFileStation() {
    try {
      const response = await axiosInstance.get(`${this.baseUrl}/webapi/auth.cgi`, {
        params: {
          api: 'SYNO.API.Auth',
          version: '3',
          method: 'login',
          account: this.username,
          passwd: this.password,
          session: 'FileStation',
          format: 'sid'
        }
      });

      if (response.data && response.data.success) {
        this.fileStationSid = response.data.data.sid;
        console.log(`[FileStation] Login successful`);
        return this.fileStationSid;
      } else {
        throw new Error(response.data.error?.code || 'FileStation login failed');
      }
    } catch (error) {
      throw new Error(`FileStation login error: ${error.message}`);
    }
  }

  /**
   * Copy file on NAS from one location to another using File Station API
   */
  async copyFileOnNAS(sourcePath, destPath) {
    // Login to File Station (different session)
    if (!this.fileStationSid) await this.loginFileStation();

    try {
      console.log(`[FileStation] Copying: ${sourcePath} -> ${destPath}`);

      // Start copy task using GET with URL parameters
      const pathsArray = [sourcePath];
      const response = await axiosInstance.get(`${this.baseUrl}/webapi/entry.cgi`, {
        params: {
          api: 'SYNO.FileStation.CopyMove',
          version: '3',
          method: 'start',
          path: JSON.stringify(pathsArray),
          dest_folder_path: destPath,
          overwrite: true,
          remove_src: false,
          _sid: this.fileStationSid
        },
        timeout: 120000 // 2 minutes timeout
      });

      console.log(`[FileStation] Response:`, JSON.stringify(response.data));

      if (response.data && response.data.success) {
        const taskId = response.data.data.taskid;
        console.log(`[FileStation] Task ID: ${taskId}`);

        // Wait for task to complete
        let completed = false;
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes max

        while (!completed && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

          const statusResponse = await axiosInstance.get(`${this.baseUrl}/webapi/entry.cgi`, {
            params: {
              api: 'SYNO.FileStation.CopyMove',
              version: '3',
              method: 'status',
              taskid: taskId,
              _sid: this.fileStationSid
            }
          });

          console.log(`[FileStation] Status check ${attempts + 1}:`, JSON.stringify(statusResponse.data));

          if (statusResponse.data && statusResponse.data.success) {
            const finished = statusResponse.data.data.finished;
            if (finished) {
              completed = true;
              console.log(`[FileStation] Task completed successfully`);
            }
          }
          attempts++;
        }

        if (!completed) {
          throw new Error('Copy task timeout');
        }

        return true;
      } else {
        throw new Error(`Copy failed: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.error(`[FileStation] Error:`, error);
      throw new Error(`Copy file error: ${error.message}`);
    }
  }
}

module.exports = SynologyService;
