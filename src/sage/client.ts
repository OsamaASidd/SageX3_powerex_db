import axios from 'axios';
import { config } from '../config';

export const sageHttp = axios.create({
  baseURL: config.sage.baseUrl,
  auth: {
    username: config.sage.username,
    password: config.sage.password,
  },
  timeout: 30000,
});
