const userModel = require("../models/User");
const bcrypt = require("bcrypt");
const cloudinary = require("cloudinary").v2;
const { paginate } = require("../utils/pagination");
const AuthSession = require("../models/AuthSession");
const notificationController = require("./notificationController");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
class UserController {
  async createUser(req, res, next) {
    try {
      const validated = req.validatedBody;
      const hashedPassword = await bcrypt.hash(validated.password, 9);
      const user = await userModel.create({
        ...validated,
        password: hashedPassword,
      });

      res.status(201).json({
        success: true,
        message: "User created successfully",
        data: user,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Email đã được đăng ký" });
      }
      next(error);
    }
  }

  async getAllUsers(req, res, next) {
    try {
      const { data, pagination } = await paginate(userModel, req.query, {});

      res.status(200).json({
        success: true,
        message: "Users retrieved successfully",
        data: data,
        pagination: pagination,
      });
    } catch (error) {
      next(error);
    }
  }
  async getUserById(req, res, next) {
    try {
      const user = await userModel.findById(req.params._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        message: "User retrieved successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req, res, next) {
    try {
      const validated = req.validatedBody;
      const getUserAvatar = await userModel.findById(req.params._id);
      if (!getUserAvatar) return res.status(404).json({success:false,message:'User not found'});
      let result = getUserAvatar.avatar;
      if (req.file) {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "avatar_users", resource_type: "image" },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            },
          );
          stream.end(req.file.buffer);
        });

        result = {
          url: uploadResult.secure_url,
          public_id: uploadResult.public_id,
        };
      }
      const newData = {
        ...validated,
        avatar: result,
      };
      const user = await userModel.findByIdAndUpdate(req.params._id, newData, {
        new: true,
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (req.file && getUserAvatar.avatar?.public_id) {
        try { await cloudinary.uploader.destroy(getUserAvatar.avatar.public_id); }
        catch { require("../utils/logger").warn("Old avatar cleanup requires retry"); }
      }
      res.status(200).json({
        success: true,
        message: "User updated successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req, res, next) {
    try {
      const user = await require('../services/securityRevocationService').revoke({ userId: req.params._id,
        set: { isActive: false }, actorId: req.userId, reason: 'account_deactivated' });
      if (!user) return res.status(404).json({success:false,message:'User not found'});
      res.json({ success: true, message: 'User deactivated; historical records retained' });
    } catch (error) {
      next(error);
    }
  }

  async lockUser(req, res, next) {
    try {
      // Khóa tài khoản phải thu hồi toàn bộ truy cập đang có: tăng tokenVersion
      // (token cũ vô hiệu vĩnh viễn, kể cả sau khi mở khóa), xóa phiên làm mới
      // và đóng các luồng SSE đang mở.
      const user = await require('../services/securityRevocationService').revoke({ userId: req.params._id,
        set: { isActive: false }, actorId: req.userId, reason: 'account_locked' });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({
        success: true,
        message: "User locked successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async unlockUser(req, res, next) {
    try {
      const user = await userModel.findByIdAndUpdate(
        req.params._id,
        { isActive: true },
        { new: true },
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        message: "User unlocked successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAddress(req, res, next) {
    try {
      const newAddress = {
        fullName: req.validatedBody.fullName,
        country: req.validatedBody.country,
        city: req.validatedBody.city,
        district: req.validatedBody.district,
        address: req.validatedBody.address,
        phone: req.validatedBody.phone,
      };
      const user = await userModel.findByIdAndUpdate(
        req.params._id,
        { $push: { addresses: newAddress } },
        { new: true },
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        message: "Address updated successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async editAddress(req, res, next) {
    try {
      const user = await userModel.findById(req.params._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const addressIndex = user.addresses.findIndex(
        (addr) => addr._id.toString() === req.params.address_id,
      );
      if (addressIndex === -1) {
        return res.status(404).json({ message: "Address not found" });
      }
      if (req.validatedBody.fullName !== undefined) user.addresses[addressIndex].fullName = req.validatedBody.fullName;
      user.addresses[addressIndex].country =
        req.validatedBody.country || user.addresses[addressIndex].country;
      user.addresses[addressIndex].city =
        req.validatedBody.city || user.addresses[addressIndex].city;
      user.addresses[addressIndex].district =
        req.validatedBody.district || user.addresses[addressIndex].district;
      user.addresses[addressIndex].address =
        req.validatedBody.address || user.addresses[addressIndex].address;
      user.addresses[addressIndex].phone =
        req.validatedBody.phone || user.addresses[addressIndex].phone;
      await user.save();
      res.status(200).json({
        success: true,
        message: "Address edited successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteAddress(req, res, next) {
    try {
      const user = await userModel.findByIdAndUpdate(
        req.params._id,
        { $pull: { addresses: { _id: req.params.address_id } } },
        { new: true },
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        message: "Address deleted successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyProfile(req, res, next) {
    try {
      const user = await userModel.findById(req.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({
        success: true,
        message: "Profile retrieved successfully",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();
