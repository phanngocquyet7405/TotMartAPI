const userModel = require("../models/User");
const bcrypt = require("bcrypt");
const cloudinary = require("cloudinary").v2;
const { paginate } = require("../utils/pagination");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
class UserController {
  async createUser(req, res) {
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
      res.status(500).json({ message: error });
    }
  }

  async getAllUsers(req, res) {
    try {
      const { data, pagination } = await paginate(userModel, req.query, {
        isActive: true,
      });

      res.status(200).json({
        success: true,
        message: "Users retrieved successfully",
        data: data,
        pagination: pagination,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  async getUserById(req, res) {
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
      res.status(500).json({ message: error });
    }
  }

  async updateUser(req, res, next) {
    try {
      const validated = req.validatedBody;
      const getUserAvatar = await userModel.findById(req.params._id);
      let result = getUserAvatar.avatar;
      if (req.file) {
        if (result?.public_id) {
          await cloudinary.uploader.destroy(result.public_id);
        }
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
      const foundUser = await userModel.findById(req.params._id);
      if (!foundUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      
      if (foundUser.avatar && foundUser.avatar.public_id) {
        await cloudinary.uploader.destroy(foundUser.avatar.public_id);
      }

      await userModel.findByIdAndDelete(req.params._id);
      res
        .status(200)
        .json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async lockUser(req, res, next) {
    try {
      const user = await userModel.findByIdAndUpdate(
        req.params._id,
        { isActive: false },
        { new: true },
      );
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
        country: req.body.country,
        city: req.body.city,
        district: req.body.district,
        address: req.body.address,
        phone: req.body.phone,
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
      user.addresses[addressIndex].country =
        req.body.country || user.addresses[addressIndex].country;
      user.addresses[addressIndex].city =
        req.body.city || user.addresses[addressIndex].city;
      user.addresses[addressIndex].district =
        req.body.district || user.addresses[addressIndex].district;
      user.addresses[addressIndex].address =
        req.body.address || user.addresses[addressIndex].address;
      user.addresses[addressIndex].phone =
        req.body.phone || user.addresses[addressIndex].phone;
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
