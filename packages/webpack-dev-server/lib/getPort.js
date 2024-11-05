"use strict";

/*
 * Based on the packages get-port https://www.npmjs.com/package/get-port
 * and portfinder https://www.npmjs.com/package/portfinder
 * The code structure is similar to get-port, but it searches
 * ports deterministically like portfinder
 */
const net = require("net");
const os = require("os");

const minPort = 1024;
const maxPort = 65_535;

/**
 * 返回一组本地主机地址的集合，用于检测本地所有可能的网络接口
 */
const getLocalHosts = () => {
  // 获取系统的网络接口列表
  const interfaces = os.networkInterfaces();

  // eslint-disable-next-line no-undefined
  // undefined（默认主机）和 0.0.0.0（通常绑定到所有可用的 IPv4 地址）
  const results = new Set([undefined, "0.0.0.0"]);

  for (const _interface of Object.values(interfaces)) {
    if (_interface) {
      for (const config of _interface) {
        results.add(config.address);
      }
    }
  }

  return results;
};

/**
 * 用于检查指定端口在某个主机上是否可用
 * @param {number} basePort
 * @param {string | undefined} host
 * @return {Promise<number>}
 */
const checkAvailablePort = (basePort, host) =>
  new Promise((resolve, reject) => {
    // 创建服务器实例
    const server = net.createServer();
    /**
     * 将创建的 server 实例标记为“非活动”状态
     * 如果没有其他阻塞操作，这样设置可以允许 Node.js 事件循环在其他所有操作完成后直接退出，而不会因为这个服务器实例而阻塞
     *
     * 当你创建一个 server（比如 TCP 服务器），这个服务器会阻止 Node.js 进程退出，
     * 直到这个 server 被关闭。这意味着即使没有其他活动，Node.js 会保持进程运行
     */
    server.unref();
    server.on("error", reject);

    // 尝试在指定的主机和端口上监听
    server.listen(basePort, host, () => {
      // 监听成功，表示端口在该地址下可用
      // 获取绑定的端口号，确保绑定信息已成功
      const { port } = server.address();
      // 关闭服务器
      server.close(() => {
        resolve(port);
      });
    });
  });

/**
 * 通过检查在本地所有主机名（包括 localhost、0.0.0.0 以及其他局域网 IP 地址）
 * 上指定端口是否被占用，来确保找到一个真正可用的端口
 * @param {number} port 要检查的端口
 * @param {Set<string|undefined>} hosts 主机地址集合
 * @return {Promise<number>}
 */
const getAvailablePort = async (port, hosts) => {
  /**
   * - EADDRNOTAVAIL：地址不可用
   * - EINVAL：无效参数
   */
  const nonExistentInterfaceErrors = new Set(["EADDRNOTAVAIL", "EINVAL"]);
  for (const host of hosts) {
    try {
      // 检查端口是否在该主机上可用
      await checkAvailablePort(port, host);
    } catch (error) {
      // 不属于定义的错误时抛出错误
      if (!nonExistentInterfaceErrors.has(error.code)) {
        throw error;
      }
    }
  }

  return port;
};

/**
 * 用于在给定范围内寻找一个可用的端口，以避免端口冲突导致的程序异常终止
 * 通过遍历端口范围并在每个端口上测试其可用性来寻找第一个可用的端口。
 * 如果给定端口不可用，则会自动尝试下一个端口，直到找到一个可用端口或达到范围上限
 * @param {number} basePort 起始端口号
 * @param {string=} host
 * @return {Promise<number>}
 */
async function getPorts(basePort, host) {
  // 确保起始端口号在可查找范围内
  if (basePort < minPort || basePort > maxPort) {
    throw new Error(`Port number must lie between ${minPort} and ${maxPort}`);
  }

  let port = basePort;
  const localhosts = getLocalHosts();
  let hosts;
  // 传入的 host 参数不是本地主机地址，将使用传入的 host 进行检查
  if (host && !localhosts.has(host)) {
    hosts = new Set([host]);
  } else {
    // 默认将所有等价于 localhost 的地址作为 hosts 集合，用于检测该端口在不同 localhost 地址下的占用情况
    hosts = localhosts;
  }

  /**
   * 包含端口不可用错误的集合
   * - EADDRINUSE 表示端口已被占用
   * - EACCES 表示权限不足
   * 仅当出现这些错误时，函数会尝试下一个端口
   */
  const portUnavailableErrors = new Set(["EADDRINUSE", "EACCES"]);
  // 循环从 basePort 到 maxPort 范围内的每一个端口，直到找到可用的端口号
  while (port <= maxPort) {
    try {
      // 获取可用的端口号，并返回
      const availablePort = await getAvailablePort(port, hosts); // eslint-disable-line no-await-in-loop
      return availablePort;
    } catch (error) {
      /* Try next port if port is busy; throw for any other error */
      if (!portUnavailableErrors.has(error.code)) {
        throw error;
      }
      port += 1;
    }
  }

  throw new Error("No available ports found");
}

module.exports = getPorts;
